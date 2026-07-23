import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from './db.js'
import { initializeDatabase, ensureAdminUser } from './init.js'
import { authMiddleware, signToken } from './middleware/auth.js'
import { hashPassword, verifyPassword, isHashed } from './utils/password.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isProduction = process.env.NODE_ENV === 'production'

const app = express()
const PORT = process.env.PORT || 5000

const corsOrigin = process.env.CORS_ORIGIN
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true } : undefined))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

await initializeDatabase().catch((error) => {
  console.error('Failed to initialize database:', error.message)
  console.error('Check DB_HOST / DB_PASSWORD / Postgres container (NAS: service name is "db").')
  if (process.env.NODE_ENV === 'production') {
    // Crash so Docker restarts until Postgres is reachable with the right password
    process.exit(1)
  }
})

const EDIT_WINDOW_HOURS = 48

function parseAmount(value) {
  if (!value) return 0
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  return Number(cleaned) || 0
}

function formatRupee(amount) {
  return `₹ ${Math.round(amount).toLocaleString('en-IN')}`
}

async function getProductCodeItems(productCodeId, client = pool) {
  const result = await client.query(
    `SELECT pci.id, pci.qty_per_unit, i.id AS inventory_id, i.name, i.sku,
            i.available, i.pending, i.reserved, i.required_qty, i.status,
            COALESCE((
              SELECT SUM(pci2.qty_per_unit * oi.qty)::int
              FROM product_code_items pci2
              JOIN order_items oi ON oi.product_code_id = pci2.product_code_id
              JOIN orders o ON o.id = oi.order_id
              WHERE pci2.inventory_id = i.id AND o.status = 'Pending'
            ), 0)::int AS booked
     FROM product_code_items pci
     JOIN inventory i ON i.id = pci.inventory_id
     WHERE pci.product_code_id = $1
     ORDER BY i.name`,
    [productCodeId]
  )
  return result.rows.map((row) => {
    const booked = Number(row.booked) || 0
    return {
      ...row,
      available: Number(row.available) || 0,
      booked,
      pending: booked,
      required_qty: booked,
    }
  })
}

/** Cached low-stock target from company_settings (available < target → Low Stock) */
let lowStockTargetCache = { value: 20, at: 0 }

function invalidateLowStockTargetCache() {
  lowStockTargetCache.at = 0
}

async function getLowStockTarget(client = pool) {
  if (Date.now() - lowStockTargetCache.at < 5000) return lowStockTargetCache.value
  try {
    const result = await client.query(
      `SELECT COALESCE(low_stock_target, 20)::int AS low_stock_target
       FROM company_settings
       ORDER BY id
       LIMIT 1`
    )
    const value = Math.max(0, Number(result.rows[0]?.low_stock_target) || 20)
    lowStockTargetCache = { value, at: Date.now() }
    return value
  } catch {
    return lowStockTargetCache.value || 20
  }
}

function resolveItemTarget(row, globalTarget = lowStockTargetCache.value || 20) {
  if (row && row.stock_target != null && row.stock_target !== '') {
    const n = Number(row.stock_target)
    if (Number.isFinite(n)) return Math.max(0, n)
  }
  return Math.max(0, Number(globalTarget) || 20)
}

function inventoryStatus(available, requiredQty = 0, lowStockTarget = lowStockTargetCache.value || 20) {
  const avail = Number(available) || 0
  const target = Math.max(0, Number(lowStockTarget) || 20)
  if (avail < 0) return 'Defect'
  if (avail <= 0) return 'Defect'
  if (requiredQty > 0 && avail < requiredQty) return 'Low Stock'
  if (avail < target) return 'Low Stock'
  return 'Stock Available'
}

function mapInventoryRow(row, lowStockTarget = lowStockTargetCache.value || 20) {
  if (!row) return row
  const available = Number(row.available) || 0
  // Booked / Required = qty reserved by Pending sales orders
  const booked = Number(row.sales_required ?? row.pending) || 0
  const used = Number(row.qty_used ?? row.used) || 0
  const itemTarget = resolveItemTarget(row, lowStockTarget)
  return {
    ...row,
    qty: available,
    available,
    rate: Number(row.rate) || 0,
    stock_target: row.stock_target != null && row.stock_target !== '' ? Number(row.stock_target) : null,
    effective_target: itemTarget,
    required_qty: booked,
    sales_required: booked,
    qty_used: used,
    used,
    monthly_avg: Number(row.monthly_avg) || 0,
    booked,
    pending: booked,
    remaining: available,
    status: inventoryStatus(available, booked, itemTarget),
  }
}

async function refreshAllInventoryStatuses(client = pool) {
  const globalTarget = await getLowStockTarget(client)
  const rows = await client.query('SELECT id, available, stock_target FROM inventory')
  for (const row of rows.rows) {
    const booked = await getBookedQtyForInventory(row.id, client)
    const target = resolveItemTarget(row, globalTarget)
    const status = inventoryStatus(Number(row.available), booked, target)
    await client.query(
      `UPDATE inventory SET pending = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [booked, status, row.id]
    )
  }
  return globalTarget
}

/** Keep last 5 rates per inventory item (queue). */
async function recordInventoryRate(inventoryId, rate, userId, note = '', client = pool) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return
  await client.query(
    `INSERT INTO inventory_rate_history (inventory_id, rate, note, created_by)
     VALUES ($1, $2, $3, $4)`,
    [inventoryId, value, note || '', userId || null]
  )
  await client.query(
    `DELETE FROM inventory_rate_history
     WHERE inventory_id = $1
       AND id NOT IN (
         SELECT id FROM inventory_rate_history
         WHERE inventory_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 5
       )`,
    [inventoryId]
  )
}

async function getInventoryRateHistory(inventoryId, client = pool) {
  const result = await client.query(
    `SELECT id, rate::float AS rate, note, created_by, created_at
     FROM inventory_rate_history
     WHERE inventory_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 5`,
    [inventoryId]
  )
  return result.rows
}

async function getBookedQtyForInventory(inventoryId, client = pool) {
  const result = await client.query(
    `SELECT COALESCE(SUM(pci.qty_per_unit * oi.qty), 0)::int AS booked
     FROM product_code_items pci
     JOIN order_items oi ON oi.product_code_id = pci.product_code_id
     JOIN orders o ON o.id = oi.order_id
     WHERE pci.inventory_id = $1 AND o.status = 'Pending'`,
    [inventoryId]
  )
  return Number(result.rows[0]?.booked) || 0
}

/** Calendar month key YYYY-MM (resets each month). Uses closed_at for completed sales. */
function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatYearMonthLabel(ym) {
  const [y, m] = String(ym || '').split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mi = Number(m) - 1
  if (!y || mi < 0 || mi > 11) return String(ym || '—')
  return `${months[mi]} ${y}`
}

/** Recompute + store monthly sold qty for one product (Completed orders). */
async function syncProductMonthlyStats(productCodeId, client = pool) {
  await client.query(
    `INSERT INTO monthly_qty_stats (kind, ref_id, year_month, qty, updated_at)
     SELECT
       'product',
       $1::int,
       TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM'),
       SUM(oi.qty)::numeric,
       CURRENT_TIMESTAMP
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_code_id = $1
       AND o.status = 'Completed'
     GROUP BY TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM')
     ON CONFLICT (kind, ref_id, year_month)
     DO UPDATE SET qty = EXCLUDED.qty, updated_at = CURRENT_TIMESTAMP`,
    [productCodeId]
  )
}

/** Recompute + store monthly used qty for one inventory part (Completed BOM usage). */
async function syncInventoryMonthlyStats(inventoryId, client = pool) {
  await client.query(
    `INSERT INTO monthly_qty_stats (kind, ref_id, year_month, qty, updated_at)
     SELECT
       'inventory',
       $1::int,
       TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM'),
       SUM(pci.qty_per_unit * oi.qty)::numeric,
       CURRENT_TIMESTAMP
     FROM product_code_items pci
     JOIN order_items oi ON oi.product_code_id = pci.product_code_id
     JOIN orders o ON o.id = oi.order_id
     WHERE pci.inventory_id = $1
       AND o.status = 'Completed'
     GROUP BY TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM')
     ON CONFLICT (kind, ref_id, year_month)
     DO UPDATE SET qty = EXCLUDED.qty, updated_at = CURRENT_TIMESTAMP`,
    [inventoryId]
  )
}

async function getStoredMonthlyStats(kind, refId, client = pool) {
  const result = await client.query(
    `SELECT year_month, qty::float AS qty
     FROM monthly_qty_stats
     WHERE kind = $1 AND ref_id = $2
     ORDER BY year_month DESC`,
    [kind, refId]
  )
  const thisMonth = currentYearMonth()
  return result.rows.map((row) => ({
    year_month: row.year_month,
    label: formatYearMonthLabel(row.year_month),
    qty: Number(row.qty) || 0,
    is_current: row.year_month === thisMonth,
  }))
}

async function getCurrentMonthQty(kind, refId, client = pool) {
  const ym = currentYearMonth()
  const result = await client.query(
    `SELECT qty::float AS qty FROM monthly_qty_stats
     WHERE kind = $1 AND ref_id = $2 AND year_month = $3`,
    [kind, refId, ym]
  )
  return Number(result.rows[0]?.qty) || 0
}

async function checkStockForProductCode(productCodeId, multiplier, client = pool) {
  const items = await getProductCodeItems(productCodeId, client)
  const warnings = []
  const codeRes = await client.query(
    'SELECT code, name, COALESCE(stock_qty, 0)::int AS stock_qty FROM product_codes WHERE id = $1',
    [productCodeId]
  )
  const stockQty = Number(codeRes.rows[0]?.stock_qty) || 0
  if (stockQty < multiplier) {
    warnings.push({
      name: codeRes.rows[0]?.code || `Product #${productCodeId}`,
      sku: 'product',
      needed: multiplier,
      available: stockQty,
      remaining: stockQty - multiplier,
      message: `Product stock: need ${multiplier}, available ${stockQty}, short by ${multiplier - stockQty}`,
      kind: 'product',
    })
  }
  for (const item of items) {
    const needed = item.qty_per_unit * multiplier
    if (item.available < needed) {
      warnings.push({
        name: item.name,
        sku: item.sku,
        needed,
        available: item.available,
        remaining: Math.max(0, item.available - needed),
        message: `${item.name}: need ${needed}, available ${item.available}, short by ${needed - item.available}`,
        kind: 'inventory',
      })
    }
  }
  return warnings
}

async function adjustProductStockQty(productCodeId, qtyDelta, client = pool) {
  // qtyDelta: negative to deduct sold qty, positive to restore
  await client.query(
    `UPDATE product_codes
     SET stock_qty = COALESCE(stock_qty, 0) + $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [qtyDelta, productCodeId]
  )
}

async function adjustStockForProductCode(productCodeId, multiplier, direction, client = pool) {
  // direction: 1 = book/reserve (deduct inventory + product), -1 = release/restore
  // available can go negative when stock is short (MFG shows red)
  const target = await getLowStockTarget(client)
  const items = await getProductCodeItems(productCodeId, client)

  // Product finished-goods stock
  await adjustProductStockQty(productCodeId, -multiplier * direction, client)

  for (const item of items) {
    const delta = item.qty_per_unit * multiplier * direction
    const row = (
      await client.query('SELECT available, pending, reserved, required_qty FROM inventory WHERE id = $1 FOR UPDATE', [
        item.inventory_id,
      ])
    ).rows[0]
    if (!row) continue

    const newAvailable = Number(row.available) - delta
    const newPending = Math.max(0, Number(row.pending || 0) + delta)
    const newReserved = Math.max(0, Number(row.reserved || 0) + delta)
    // Status from remaining available vs sales-booked demand (pending)
    const status = inventoryStatus(newAvailable, newPending, target)

    await client.query(
      'UPDATE inventory SET available = $1, pending = $2, reserved = $3, status = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
      [newAvailable, newPending, newReserved, status, item.inventory_id]
    )
  }
}

async function reserveStockForProductCode(productCodeId, multiplier, client = pool) {
  return adjustStockForProductCode(productCodeId, multiplier, 1, client)
}

async function releaseStockForProductCode(productCodeId, multiplier, client = pool) {
  return adjustStockForProductCode(productCodeId, multiplier, -1, client)
}

function requireRoles(allowedRoles) {
  return (req, res, next) => {
    const user = req.user
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    next()
  }
}

function enforceEditWindowOrOwnership(req, existing) {
  // Admin can edit everything.
  if (req.user?.role === 'admin') return true

  // Others can edit only records they created within EDIT_WINDOW_HOURS.
  if (!existing) return false
  const createdByOk = existing.created_by === req.user.id
  const createdAt = new Date(existing.created_at)
  const ageMs = Date.now() - createdAt.getTime()
  const withinWindow = ageMs <= EDIT_WINDOW_HOURS * 60 * 60 * 1000
  return createdByOk && withinWindow
}

// Public routes (registration disabled — admin creates users via /api/admin/users)
app.post('/api/signup', (_req, res) => {
  return res.status(403).json({ message: 'Registration is disabled. Contact admin to create an account.' })
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  try {
    // Heal missing users table / admin before login (NAS)
    try {
      await ensureAdminUser(false)
    } catch (healErr) {
      console.error('ensureAdminUser during login:', healErr.message)
    }

    let result = await pool.query(
      'SELECT id, name, email, role, password FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    )

    // Bootstrap admin on fresh NAS if account missing
    if (result.rows.length === 0 && String(email).trim().toLowerCase() === 'harsh@gmail.com') {
      await ensureAdminUser(true)
      result = await pool.query(
        'SELECT id, name, email, role, password FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      )
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    const user = result.rows[0]
    let valid = await verifyPassword(password, user.password)

    // One-shot heal: on Docker/NAS, if default admin password fails, reset to 123456 once
    if (
      !valid &&
      String(email).trim().toLowerCase() === 'harsh@gmail.com' &&
      password === '123456' &&
      String(process.env.DB_HOST || '') === 'db'
    ) {
      await ensureAdminUser(true)
      result = await pool.query(
        'SELECT id, name, email, role, password FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      )
      valid = await verifyPassword(password, result.rows[0]?.password)
    }

    if (!valid) {
      return res.status(401).json({
        message: 'Invalid credentials. NAS default: harsh@gmail.com / 123456 — or open /api/fix-admin once.',
      })
    }

    const profile = result.rows[0]
    if (!isHashed(profile.password)) {
      const hashedPassword = await hashPassword(password)
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, profile.id])
    }

    const token = signToken({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role || 'admin',
    })
    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role || 'pending',
      },
      token,
    })
  } catch (error) {
    console.error('Login error:', error)
    const code = error?.code || ''
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === '57P01') {
      return res.status(503).json({
        message: 'Database unavailable. Check salesinventory-db-1 is healthy and DB_PASSWORD matches the db container.',
      })
    }
    if (code === '28P01') {
      return res.status(503).json({
        message: 'Database password rejected. App DB_PASSWORD must match db POSTGRES_PASSWORD (often changeme).',
      })
    }
    if (code === '3D000') {
      return res.status(503).json({
        message: 'Database name not found. Check DB_NAME=billing.',
      })
    }
    return res.status(500).json({
      message: error?.message ? `Server error: ${error.message}` : 'Server error',
      code: code || undefined,
    })
  }
})

app.get('/api/health', async (req, res) => {
  try {
    const info = await pool.query('SELECT current_database() AS db, NOW() AS now')
    let users = 0
    let admin = false
    try {
      const u = await pool.query('SELECT COUNT(*)::int AS count FROM users')
      users = u.rows[0].count
      const a = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = 'harsh@gmail.com' LIMIT 1`
      )
      admin = a.rows.length > 0
    } catch {
      users = -1
    }
    res.json({
      status: 'ok',
      database: 'connected',
      db: info.rows[0].db,
      host: process.env.DB_HOST || '(url)',
      ssl: process.env.DB_SSL || 'default',
      users,
      admin,
      loginHint: 'harsh@gmail.com / 123456',
    })
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      host: process.env.DB_HOST || '(url)',
      message: error?.message || 'db error',
    })
  }
})

// One-time NAS repair: open in browser → http://NAS_IP:5080/api/fix-admin
app.get('/api/fix-admin', async (req, res) => {
  try {
    if (String(process.env.DB_HOST || '') !== 'db' && process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        message: 'fix-admin is only enabled for Docker/NAS (DB_HOST=db).',
      })
    }
    const result = await ensureAdminUser(true)
    res.json({
      ok: true,
      ...result,
      email: 'harsh@gmail.com',
      password: '123456',
      next: 'Go to /login and sign in with those credentials.',
    })
  } catch (error) {
    console.error('fix-admin error:', error)
    res.status(500).json({
      ok: false,
      message: error?.message || 'Failed to reset admin',
    })
  }
})

// Protected routes (public paths already registered above)
app.use('/api', (req, res, next) => {
  const p = req.path || ''
  if (p === '/login' || p === '/health' || p === '/signup' || p === '/fix-admin') return next()
  return authMiddleware(req, res, next)
})

app.get('/api/auth/me', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }
    const profile = result.rows[0]
    res.json({
      ...profile,
      role: profile.role || req.user.role || 'pending',
    })
  } catch (error) {
    console.error('Auth me error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/auth/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' })
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' })
  }

  try {
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const valid = await verifyPassword(currentPassword, result.rows[0].password)
    if (!valid) {
      return res.status(401).json({ message: 'Current password is incorrect.' })
    }

    const hashedPassword = await hashPassword(newPassword)
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id])
    res.json({ message: 'Password updated successfully.' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/auth/profile', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ message: 'Name is required.' })
  }
  if (name.length > 120) {
    return res.status(400).json({ message: 'Name is too long.' })
  }

  try {
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, role, created_at',
      [name, req.user.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }
    const profile = result.rows[0]
    res.json({
      ...profile,
      role: profile.role || req.user.role || 'pending',
    })
  } catch (error) {
    console.error('Profile update error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Admin: manage users/roles
app.get('/api/admin/users', requireRoles(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Admin users fetch error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/admin/users', requireRoles(['admin']), async (req, res) => {
  const { name, email, password, role } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' })
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' })
  }

  const allowed = ['admin', 'inventory', 'sales', 'pending']
  const nextRole = role && allowed.includes(role) ? role : 'pending'

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists.' })
    }

    const hashedPassword = await hashPassword(password)
    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email, hashedPassword, nextRole]
    )
    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Admin create user error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.patch('/api/admin/users/:id/role', requireRoles(['admin']), async (req, res) => {
  const { id } = req.params
  const { role } = req.body

  const allowed = ['admin', 'inventory', 'sales', 'pending']
  if (!role || !allowed.includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' })
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role, created_at',
      [role, id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Admin update role error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/admin/users/:id', requireRoles(['admin']), async (req, res) => {
  const { id } = req.params
  const { name, email, role, password } = req.body

  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required.' })
  }

  const allowed = ['admin', 'inventory', 'sales', 'pending']
  if (role && !allowed.includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' })
  }

  if (password && password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' })
  }

  try {
    const existing = await pool.query('SELECT id, email FROM users WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, id])
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Email already in use.' })
    }

    let query
    let params
    if (password) {
      const hashedPassword = await hashPassword(password)
      query = 'UPDATE users SET name = $1, email = $2, role = COALESCE($3, role), password = $4 WHERE id = $5 RETURNING id, name, email, role, created_at'
      params = [name, email, role || null, hashedPassword, id]
    } else {
      query = 'UPDATE users SET name = $1, email = $2, role = COALESCE($3, role) WHERE id = $4 RETURNING id, name, email, role, created_at'
      params = [name, email, role || null, id]
    }

    const result = await pool.query(query, params)
    res.json(result.rows[0])
  } catch (error) {
    console.error('Admin update user error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.delete('/api/admin/users/:id', requireRoles(['admin']), async (req, res) => {
  const { id } = req.params
  const targetId = Number(id)

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account.' })
  }

  try {
    const target = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId])
    if (target.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }

    if (target.rows[0].role === 'admin') {
      const adminCount = await pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`)
      if (adminCount.rows[0].count <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin account.' })
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [targetId])
    res.json({ message: 'User deleted successfully.' })
  } catch (error) {
    console.error('Admin delete user error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/dashboard/stats', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const { month, year } = req.query

    let dateFilter = ''
    const params = []

    if (month && year) {
      params.push(Number(year), Number(month))
      dateFilter = ` AND EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2`
    } else if (year) {
      params.push(Number(year))
      dateFilter = ` AND EXTRACT(YEAR FROM created_at) = $1`
    }

    const [orders, customers, products, inventory, revenue, amounts, pending] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM orders WHERE 1=1${dateFilter}`, params),
      pool.query('SELECT COUNT(*)::int AS count FROM customers'),
      pool.query('SELECT COUNT(*)::int AS count FROM products'),
      pool.query('SELECT COUNT(*)::int AS count FROM inventory'),
      pool.query(`SELECT COALESCE(SUM(qty), 0)::int AS total_qty FROM orders WHERE status != 'Cancelled'${dateFilter}`, params),
      pool.query(`SELECT amount FROM orders WHERE status != 'Cancelled'${dateFilter}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM orders WHERE status = 'Pending'${dateFilter}`, params),
    ])

    const lowStock = await pool.query("SELECT COUNT(*)::int AS count FROM inventory WHERE status IN ('Low Stock', 'Defect', 'Critical')")
    const totalRevenue = amounts.rows.reduce((sum, row) => sum + parseAmount(row.amount), 0)

    res.json({
      totalOrders: orders.rows[0].count,
      totalCustomers: customers.rows[0].count,
      totalProducts: products.rows[0].count,
      totalInventory: inventory.rows[0].count,
      totalQuantity: revenue.rows[0].total_qty,
      lowStockItems: lowStock.rows[0].count,
      totalRevenue: formatRupee(totalRevenue),
      pendingOrders: pending.rows[0].count,
      filterApplied: Boolean(month || year),
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/dashboard/charts', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear()
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const monthlyOrders = await pool.query(
      `SELECT EXTRACT(MONTH FROM created_at)::int AS month,
              COUNT(*)::int AS orders,
              COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN qty ELSE 0 END), 0)::int AS units
       FROM orders
       WHERE EXTRACT(YEAR FROM created_at) = $1
       GROUP BY EXTRACT(MONTH FROM created_at)
       ORDER BY month`,
      [year]
    )

    const monthlyAmounts = await pool.query(
      `SELECT EXTRACT(MONTH FROM created_at)::int AS month, amount
       FROM orders
       WHERE status <> 'Cancelled' AND EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    )

    const revenueByMonth = {}
    for (const row of monthlyAmounts.rows) {
      revenueByMonth[row.month] = (revenueByMonth[row.month] || 0) + parseAmount(row.amount)
    }

    const ordersByMonth = {}
    const unitsByMonth = {}
    for (const row of monthlyOrders.rows) {
      ordersByMonth[row.month] = row.orders
      unitsByMonth[row.month] = row.units
    }

    const monthly = monthNames.map((label, index) => {
      const m = index + 1
      return {
        month: label,
        monthNum: m,
        revenue: Math.round(revenueByMonth[m] || 0),
        orders: ordersByMonth[m] || 0,
        units: unitsByMonth[m] || 0,
      }
    })

    const inventory = await pool.query(
      `SELECT i.id, i.name, i.available, i.status,
        COALESCE((
          SELECT SUM(pci.qty_per_unit * oi.qty)::int
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id AND o.status = 'Pending'
        ), 0)::int AS booked
       FROM inventory i
       ORDER BY i.name ASC
       LIMIT 12`
    )

    const inventoryBars = inventory.rows.map((row) => ({
      id: row.id,
      name: row.name.length > 14 ? `${row.name.slice(0, 14)}…` : row.name,
      fullName: row.name,
      available: Number(row.available) || 0,
      booked: Number(row.booked) || 0,
      status: row.status,
    }))

    const statusBreakdown = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM orders
       WHERE EXTRACT(YEAR FROM created_at) = $1
       GROUP BY status`,
      [year]
    )

    res.json({
      year,
      monthly,
      inventory: inventoryBars,
      statusBreakdown: statusBreakdown.rows,
    })
  } catch (error) {
    console.error('Dashboard charts error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const items = []
    const role = req.user.role
    const showStock = role === 'admin' || role === 'inventory'
    const showOrders = role === 'admin' || role === 'sales'

    if (showStock) {
      const lowStock = await pool.query(
        `SELECT id, name, sku, available, status, COALESCE(stock_target, 0)::int AS stock_target
         FROM inventory
         WHERE status IN ('Low Stock', 'Defect', 'Critical')
         ORDER BY available ASC
         LIMIT 50`
      )
      const outOfStock = lowStock.rows.filter((r) => Number(r.available) <= 0)
      const lowOnly = lowStock.rows.filter((r) => Number(r.available) > 0)

      if (outOfStock.length > 0) {
        items.push({
          id: 'out-of-stock',
          title: `${outOfStock.length} Out of Stock`,
          description: outOfStock
            .slice(0, 4)
            .map((r) => r.name)
            .join(', '),
          tone: 'red',
          href: '/alerts/low-stock',
          kind: 'low-stock',
        })
      }

      if (lowOnly.length > 0) {
        items.push({
          id: 'low-stock',
          title: `${lowOnly.length} Low Stock Alert${lowOnly.length > 1 ? 's' : ''}`,
          description: 'Qty below target — open to review inventory.',
          tone: 'amber',
          href: '/alerts/low-stock',
          kind: 'low-stock',
        })
      }

      if (outOfStock.length === 0 && lowOnly.length === 0) {
        items.push({
          id: 'stock-ok',
          title: 'Stock Levels Normal',
          description: 'All inventory items are within target levels.',
          tone: 'green',
        })
      }
    }

    if (showOrders) {
      const overdue = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM orders
         WHERE status = 'Pending'
           AND COALESCE(created_at, updated_at, CURRENT_TIMESTAMP) < (CURRENT_TIMESTAMP - INTERVAL '10 days')`
      )
      const overdueCount = Number(overdue.rows[0]?.count) || 0
      if (overdueCount > 0) {
        items.push({
          id: 'pending-overdue',
          title: `${overdueCount} Order${overdueCount > 1 ? 's' : ''} Pending > 10 Days`,
          description: 'Click to open overdue pending orders.',
          tone: 'amber',
          href: '/alerts/pending-orders',
          kind: 'pending-orders',
        })
      }

      const pendingOrders = await pool.query(
        `SELECT COUNT(*)::int AS count FROM orders WHERE status = 'Pending'`
      )
      const pendingCount = Number(pendingOrders.rows[0]?.count) || 0
      if (pendingCount > 0 && overdueCount === 0) {
        items.push({
          id: 'pending-orders',
          title: `${pendingCount} Pending Order${pendingCount > 1 ? 's' : ''}`,
          description: 'Orders awaiting completion or dispatch.',
          tone: 'blue',
          href: '/alerts/pending-orders',
          kind: 'pending-orders',
        })
      }
    }

    res.json(items)
  } catch (error) {
    console.error('Notifications error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Overdue / pending orders for alerts page */
app.get('/api/alerts/pending-orders', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const onlyOverdue = String(req.query.overdue || '1') !== '0'
    const result = await pool.query(
      `SELECT
         o.id,
         o.order_no,
         o.company,
         o.product_code,
         o.product_name,
         o.qty,
         o.amount,
         o.status,
         o.date,
         o.created_at,
         GREATEST(
           0,
           FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(o.created_at, o.updated_at))) / 86400)
         )::int AS days_pending
       FROM orders o
       WHERE o.status = 'Pending'
         ${
           onlyOverdue
             ? `AND COALESCE(o.created_at, o.updated_at, CURRENT_TIMESTAMP) < (CURRENT_TIMESTAMP - INTERVAL '10 days')`
             : ''
         }
       ORDER BY COALESCE(o.created_at, o.updated_at) ASC`
    )
    res.json({
      threshold_days: 10,
      rows: result.rows,
    })
  } catch (error) {
    console.error('Pending alerts error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Low stock inventory for alerts page */
app.get('/api/alerts/low-stock', requireRoles(['admin', 'inventory']), async (req, res) => {
  try {
    const globalTarget = await getLowStockTarget()
    const result = await pool.query(
      `SELECT i.*,
        COALESCE((
          SELECT SUM(pci.qty_per_unit * oi.qty)::int
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id AND o.status = 'Pending'
        ), 0)::int AS sales_required
       FROM inventory i
       WHERE i.status IN ('Low Stock', 'Defect', 'Critical')
       ORDER BY i.available ASC, i.name ASC`
    )
    res.json({
      global_target: globalTarget,
      rows: result.rows.map((row) => mapInventoryRow(row, globalTarget)),
    })
  } catch (error) {
    console.error('Low stock alerts error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/company/settings', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT company_name, address, gst_no, COALESCE(low_stock_target, 20)::int AS low_stock_target, updated_at FROM company_settings ORDER BY id LIMIT 1'
    )
    if (result.rows.length === 0) {
      return res.json({ company_name: 'Purn Sanket Electrols', address: '', gst_no: '', low_stock_target: 20 })
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Company settings fetch error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/company/settings', requireRoles(['admin']), async (req, res) => {
  const { company_name, address, gst_no, low_stock_target } = req.body
  if (!company_name) {
    return res.status(400).json({ message: 'Company name is required.' })
  }
  try {
    const existing = await pool.query(
      'SELECT id, COALESCE(low_stock_target, 20)::int AS low_stock_target FROM company_settings ORDER BY id LIMIT 1'
    )
    const target =
      low_stock_target != null && Number.isFinite(Number(low_stock_target))
        ? Math.max(0, Math.floor(Number(low_stock_target)))
        : existing.rows[0]
          ? Number(existing.rows[0].low_stock_target)
          : 20
    let result
    if (existing.rows.length === 0) {
      result = await pool.query(
        `INSERT INTO company_settings (company_name, address, gst_no, low_stock_target)
         VALUES ($1, $2, $3, $4)
         RETURNING company_name, address, gst_no, low_stock_target, updated_at`,
        [company_name, address || '', gst_no || '', target]
      )
    } else {
      result = await pool.query(
        `UPDATE company_settings
         SET company_name = $1, address = $2, gst_no = $3, low_stock_target = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING company_name, address, gst_no, low_stock_target, updated_at`,
        [company_name, address || '', gst_no || '', target, existing.rows[0].id]
      )
    }
    if (low_stock_target != null && Number.isFinite(Number(low_stock_target))) {
      invalidateLowStockTargetCache()
      await refreshAllInventoryStatuses()
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Company settings update error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Low stock target — available qty below this number shows Low Stock */
app.get('/api/inventory/settings', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  try {
    const low_stock_target = await getLowStockTarget()
    res.json({ low_stock_target })
  } catch (error) {
    console.error('Inventory settings fetch error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/inventory/settings', requireRoles(['admin', 'inventory']), async (req, res) => {
  const target = Math.max(0, Math.floor(Number(req.body?.low_stock_target)))
  if (!Number.isFinite(target)) {
    return res.status(400).json({ message: 'Enter a valid low stock target (0 or more).' })
  }
  try {
    const existing = await pool.query('SELECT id FROM company_settings ORDER BY id LIMIT 1')
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO company_settings (company_name, address, gst_no, low_stock_target)
         VALUES ('Purn Sanket Electrols', '', '', $1)`,
        [target]
      )
    } else {
      await pool.query(
        `UPDATE company_settings SET low_stock_target = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [target, existing.rows[0].id]
      )
    }
    invalidateLowStockTargetCache()
    await refreshAllInventoryStatuses()
    res.json({ low_stock_target: target })
  } catch (error) {
    console.error('Inventory settings update error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/company/order-stats', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const [total, pending, completed, thisMonth] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM orders'),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE status = 'Pending'"),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE status = 'Completed'"),
      pool.query(`SELECT COUNT(*)::int AS count FROM orders WHERE created_at >= date_trunc('month', CURRENT_DATE)`),
    ])
    res.json({
      totalOrders: total.rows[0].count,
      pendingOrders: pending.rows[0].count,
      completedOrders: completed.rows[0].count,
      ordersThisMonth: thisMonth.rows[0].count,
    })
  } catch (error) {
    console.error('Company order stats error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/search', requireRoles(['admin', 'sales']), async (req, res) => {
  const q = `%${req.query.q || ''}%`
  if (!req.query.q) {
    return res.json({ orders: [], customers: [], products: [] })
  }

  try {
    const [orders, customers, products] = await Promise.all([
      pool.query(
        'SELECT id, order_no, company, state, status FROM orders WHERE order_no ILIKE $1 OR company ILIKE $1 OR state ILIKE $1 LIMIT 10',
        [q]
      ),
      pool.query(
        'SELECT id, name, email, city, state FROM customers WHERE name ILIKE $1 OR email ILIKE $1 OR city ILIKE $1 LIMIT 10',
        [q]
      ),
      pool.query(
        'SELECT id, product_id, name, sku, category FROM products WHERE name ILIKE $1 OR sku ILIKE $1 OR category ILIKE $1 LIMIT 10',
        [q]
      ),
    ])

    res.json({
      orders: orders.rows,
      customers: customers.rows,
      products: products.rows,
    })
  } catch (error) {
    console.error('Search error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Orders
async function getOrderItems(orderId, client = pool) {
  const result = await client.query(
    `SELECT id, order_id, product_code_id, product_code, product_name, description, qty, unit_price, amount
     FROM order_items WHERE order_id = $1 ORDER BY id ASC`,
    [orderId]
  )
  return result.rows
}

function parseOrderDate(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const raw = String(value).trim()
  if (!raw) return null

  // ISO / timestamp
  const iso = new Date(raw)
  if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) return iso

  // "12 Jul 2025" / "12 Jul, 2025" / "12 July 2025"
  const monthMap = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  }
  const m = raw.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/)
  if (m) {
    const day = Number(m[1])
    const month = monthMap[m[2].toLowerCase()]
    const year = Number(m[3])
    if (month != null && day >= 1 && day <= 31) {
      return new Date(year, month, day)
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
  }

  if (!Number.isNaN(iso.getTime())) return iso
  return null
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Calendar day difference (same day = 0). */
function calendarDaysBetween(start, end) {
  if (!start || !end) return 0
  const s = startOfLocalDay(start).getTime()
  const e = startOfLocalDay(end).getTime()
  if (Number.isNaN(s) || Number.isNaN(e)) return 0
  return Math.max(0, Math.floor((e - s) / (1000 * 60 * 60 * 24)))
}

function orderStartDate(order) {
  return parseOrderDate(order.date) || parseOrderDate(order.created_at) || new Date()
}

function orderEndDate(order) {
  const closed = order.status === 'Completed' || order.status === 'Cancelled'
  if (closed) {
    return parseOrderDate(order.closed_at) || parseOrderDate(order.updated_at) || new Date()
  }
  return new Date()
}

/**
 * No of Days = inclusive calendar days from order date → today (or closing date).
 * Same day always counts as 1.
 */
function computeOrderDays(order) {
  const start = orderStartDate(order)
  const end = orderEndDate(order)
  return Math.max(1, calendarDaysBetween(start, end) + 1)
}

function formatDisplayDate(value) {
  const d = parseOrderDate(value)
  if (!d) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function computeMfgOk(items, client = pool) {
  // Pending MFG light:
  // - green when every BOM part still has free stock (available > 0), or no BOM parts
  // - red when any part is minus (available < 0) or zero while this order needs it
  if (!items?.length) return true

  let checked = 0
  for (const item of items) {
    if (!item.product_code_id) continue
    const qty = Number(item.qty) || 0
    if (qty <= 0) continue

    const codeItems = await getProductCodeItems(Number(item.product_code_id), client)
    if (codeItems.length === 0) continue

    for (const inv of codeItems) {
      const need = Number(inv.qty_per_unit) * qty
      if (need <= 0) continue
      checked += 1
      const available = Number(inv.available)

      // Stock went minus
      if (available < 0) return false

      // No free stock left for this part (0) while order needs material → not available
      if (available === 0) return false

      // Free stock still on hand
      if (available > 0) continue
    }
  }

  // No BOM / nothing to check → treat as OK (green)
  return true
}

async function enrichOrder(order, items, client = pool) {
  const productLabel =
    items.length > 1
      ? `${items.length} products`
      : items[0]?.product_code || order.product_code || '-'
  const closed = order.status === 'Completed' || order.status === 'Cancelled'
  const displayDays = computeOrderDays(order)
  const closingAt = closed ? order.closed_at || order.updated_at || null : null

  // Completed/Cancelled → always green
  // Pending → green only if stock available (> 0), red if 0 or minus
  let mfgOk = true
  if (order.status === 'Completed' || order.status === 'Cancelled') {
    mfgOk = true
  } else {
    mfgOk = await computeMfgOk(items, client)
  }

  return {
    ...order,
    items,
    product_code: productLabel,
    product_name: items.map((i) => i.product_name || i.product_code).filter(Boolean).join(', ') || order.product_name,
    no_of_days: displayDays,
    days_open: displayDays,
    days_closed: closed,
    closing_date: closingAt ? formatDisplayDate(closingAt) : null,
    closed_at: closingAt,
    mfg_ok: mfgOk,
    ok_to_mfg: mfgOk,
  }
}

async function releaseOrderItemsStock(items, client) {
  for (const item of items) {
    if (item.product_code_id) {
      await releaseStockForProductCode(Number(item.product_code_id), Number(item.qty), client)
    }
  }
}

async function reserveOrderItemsStock(items, client) {
  for (const item of items) {
    if (item.product_code_id) {
      await reserveStockForProductCode(Number(item.product_code_id), Number(item.qty), client)
    }
  }
}

/** Indian financial year: 1 Apr → 31 Mar. e.g. 21 Jul 2026 → FY 26-27 */
function getFinancialYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const year = d.getFullYear()
  const month = d.getMonth() // 0 = Jan
  const startYear = month >= 3 ? year : year - 1
  const endYear = startYear + 1
  const label = `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`
  return { startYear, endYear, label, prefix: `FY${label}_` }
}

/**
 * Next sequential order no for current FY.
 * FY 2026-27 (1 Apr 2026 – 31 Mar 2027): FY26-27_01, FY26-27_02, ...
 */
async function nextOrderNo(client = pool, atDate = new Date()) {
  const { prefix } = getFinancialYear(atDate)
  const result = await client.query(
    `SELECT order_no FROM orders
     WHERE order_no LIKE $1
     ORDER BY LENGTH(order_no) DESC, order_no DESC
     LIMIT 1`,
    [`${prefix}%`]
  )
  let next = 1
  if (result.rows[0]?.order_no) {
    const raw = String(result.rows[0].order_no).slice(prefix.length)
    const num = parseInt(raw, 10)
    if (!Number.isNaN(num) && num >= 0) next = num + 1
  }
  return `${prefix}${String(next).padStart(2, '0')}`
}

app.get('/api/orders', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const { status, search, month, year } = req.query
    let query = 'SELECT * FROM orders WHERE 1=1'
    const params = []

    if (status) {
      params.push(status)
      query += ` AND status = $${params.length}`
    }
    if (search) {
      params.push(`%${search}%`)
      query += ` AND (order_no ILIKE $${params.length} OR company ILIKE $${params.length} OR state ILIKE $${params.length})`
    }
    if (month && year) {
      params.push(Number(year), Number(month))
      query += ` AND EXTRACT(YEAR FROM created_at) = $${params.length - 1} AND EXTRACT(MONTH FROM created_at) = $${params.length}`
    } else if (year) {
      params.push(Number(year))
      query += ` AND EXTRACT(YEAR FROM created_at) = $${params.length}`
    }

    query += ` ORDER BY
      CASE WHEN order_no ~ '^FY[0-9]{2}-[0-9]{2}_' THEN 0 ELSE 1 END,
      order_no DESC,
      created_at DESC`
    const result = await pool.query(query, params)
    const withItems = await Promise.all(
      result.rows.map(async (order) => {
        const items = await getOrderItems(order.id)
        return enrichOrder(order, items)
      })
    )
    res.json(withItems)
  } catch (error) {
    console.error('Error fetching orders:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/orders/stock-check', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : []
    if (items.length === 0) {
      return res.json({ breakdown: [], products: [], warnings: [], stockOk: true })
    }

    const breakdown = []
    const products = []
    const warnings = []

    for (const line of items) {
      const codeId = Number(line.product_code_id)
      const qty = Number(line.qty) || 0
      if (!codeId || qty <= 0) continue

      const codeRes = await pool.query(
        'SELECT code, name, COALESCE(stock_qty, 0)::int AS stock_qty FROM product_codes WHERE id = $1',
        [codeId]
      )
      const label = codeRes.rows[0] ? `${codeRes.rows[0].code}` : `Product #${codeId}`
      const stockQty = Math.max(0, Number(codeRes.rows[0]?.stock_qty) || 0)
      const productRemaining = stockQty - qty

      products.push({
        product_code_id: codeId,
        product: label,
        name: codeRes.rows[0]?.name || label,
        available: stockQty,
        booked: qty,
        remaining: productRemaining,
        in_stock: productRemaining >= 0,
      })

      breakdown.push({
        type: 'product',
        product: label,
        inventory_id: null,
        name: `${label} — Product available`,
        sku: '',
        qty_per_unit: 1,
        product_qty: qty,
        available: stockQty,
        booked: qty,
        remaining: productRemaining,
        total_qty: qty,
        in_stock: productRemaining >= 0,
        display: `${label}: Product stock × ${qty}`,
      })

      const lineWarnings = await checkStockForProductCode(codeId, qty)
      const codeItems = await getProductCodeItems(codeId)

      for (const item of codeItems) {
        const booked = item.qty_per_unit * qty
        const remaining = item.available - booked
        breakdown.push({
          type: 'inventory',
          product: label,
          inventory_id: item.inventory_id,
          name: item.name,
          sku: item.sku,
          qty_per_unit: item.qty_per_unit,
          product_qty: qty,
          available: item.available,
          booked,
          remaining,
          total_qty: booked,
          in_stock: remaining >= 0,
          display: `${label}: ${item.name} × ${booked}`,
        })
      }

      for (const w of lineWarnings) {
        warnings.push({ ...w, message: `${label} — ${w.message}` })
      }
    }

    res.json({ breakdown, products, warnings, stockOk: warnings.length === 0 })
  } catch (error) {
    console.error('Multi stock check error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/orders', requireRoles(['admin', 'sales']), async (req, res) => {
  const { company, state, amount, status, force, no_of_days, ok_to_mfg } = req.body
  let lines = Array.isArray(req.body.items) ? req.body.items : []

  // Backward compatible: single product_code_id + qty
  if (lines.length === 0 && req.body.product_code_id) {
    lines = [{ product_code_id: req.body.product_code_id, qty: req.body.qty, amount: req.body.amount, price: req.body.price }]
  }

  if (!company || !state) {
    return res.status(400).json({ message: 'Company and state are required.' })
  }
  if (lines.length === 0) {
    return res.status(400).json({ message: 'Add at least one product to the order.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const normalized = []
    let totalAmount = 0
    let totalQty = 0
    const allWarnings = []

    for (const line of lines) {
      const codeId = Number(line.product_code_id)
      const qty = Number(line.qty)
      if (!codeId || !qty || qty <= 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: 'Each product needs a valid product and qty.' })
      }

      const codeRes = await client.query(
        'SELECT id, code, name, description FROM product_codes WHERE id = $1',
        [codeId]
      )
      if (codeRes.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(404).json({ message: `Product code not found (id ${codeId}).` })
      }

      const warnings = await checkStockForProductCode(codeId, qty, client)
      allWarnings.push(...warnings.map((w) => ({ ...w, message: `${codeRes.rows[0].code} — ${w.message}` })))

      const unitPriceInput = line.price ?? line.unit_price
      let unitPrice = parseAmount(unitPriceInput)
      let lineAmountValue = parseAmount(line.amount)

      if (!unitPrice && !lineAmountValue) {
        const invItems = await getProductCodeItems(codeId, client)
        let total = 0
        for (const item of invItems) {
          const priceRes = await client.query('SELECT price FROM products WHERE sku = $1 LIMIT 1', [item.sku])
          if (priceRes.rows[0]) {
            total += parseAmount(priceRes.rows[0].price) * item.qty_per_unit * qty
          }
        }
        lineAmountValue = total
        unitPrice = qty > 0 ? total / qty : 0
      } else if (unitPrice && !lineAmountValue) {
        lineAmountValue = unitPrice * qty
      } else if (!unitPrice && lineAmountValue) {
        unitPrice = qty > 0 ? lineAmountValue / qty : 0
      }

      const description = line.description || codeRes.rows[0].description || codeRes.rows[0].name || ''

      normalized.push({
        product_code_id: codeId,
        product_code: codeRes.rows[0].code,
        product_name: codeRes.rows[0].name,
        description,
        qty,
        unit_price: formatRupee(unitPrice),
        amount: formatRupee(lineAmountValue),
      })
      totalAmount += lineAmountValue
      totalQty += qty
    }

    // Allow create even when stock is short (available may go negative → MFG red)
    const orderAmount = amount ? formatRupee(parseAmount(amount)) : formatRupee(totalAmount)
    for (const line of normalized) {
      await reserveStockForProductCode(line.product_code_id, line.qty, client)
    }

    const orderNo = await nextOrderNo(client)
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const first = normalized[0]
    const mfgOk = allWarnings.length === 0

    let result
    try {
      result = await client.query(
        `INSERT INTO orders (order_no, company, state, date, qty, amount, status, created_by, product_code_id, product_code, product_name, stock_booked, no_of_days, ok_to_mfg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, $13) RETURNING *`,
        [
          orderNo,
          company,
          state,
          date,
          totalQty,
          orderAmount,
          status || 'Pending',
          req.user.id,
          first.product_code_id,
          normalized.length > 1 ? `${normalized.length} products` : first.product_code,
          normalized.length > 1 ? normalized.map((n) => n.product_name).join(', ') : first.product_name,
          0,
          mfgOk,
        ]
      )
    } catch (insertErr) {
      // Rare race: regenerate sequence once
      if (insertErr.code === '23505') {
        const retryNo = await nextOrderNo(client)
        result = await client.query(
          `INSERT INTO orders (order_no, company, state, date, qty, amount, status, created_by, product_code_id, product_code, product_name, stock_booked, no_of_days, ok_to_mfg)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, $13) RETURNING *`,
          [
            retryNo,
            company,
            state,
            date,
            totalQty,
            orderAmount,
            status || 'Pending',
            req.user.id,
            first.product_code_id,
            normalized.length > 1 ? `${normalized.length} products` : first.product_code,
            normalized.length > 1 ? normalized.map((n) => n.product_name).join(', ') : first.product_name,
            0,
            mfgOk,
          ]
        )
      } else {
        throw insertErr
      }
    }

    const orderId = result.rows[0].id
    for (const line of normalized) {
      await client.query(
        `INSERT INTO order_items (order_id, product_code_id, product_code, product_name, description, qty, unit_price, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          orderId,
          line.product_code_id,
          line.product_code,
          line.product_name,
          line.description,
          line.qty,
          line.unit_price,
          line.amount,
        ]
      )
    }

    const customerRes = await client.query('SELECT id, total_amount FROM customers WHERE name ILIKE $1 LIMIT 1 FOR UPDATE', [
      company,
    ])
    if (customerRes.rows[0]) {
      const prev = parseAmount(customerRes.rows[0].total_amount)
      const next = formatRupee(prev + parseAmount(orderAmount))
      await client.query(
        'UPDATE customers SET orders_count = orders_count + 1, total_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [next, customerRes.rows[0].id]
      )
    }

    await client.query('COMMIT')
    const items = await getOrderItems(orderId)
    const enriched = await enrichOrder(result.rows[0], items)
    res.status(201).json({
      ...enriched,
      stockOk: allWarnings.length === 0,
      warnings: allWarnings,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error creating order:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

app.put('/api/orders/:id', requireRoles(['admin', 'sales']), async (req, res) => {
  const { id } = req.params
  const { company, state, amount, status } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existingRes = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])
    if (existingRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'Order not found' })
    }

    const existing = existingRes.rows[0]
    if (!enforceEditWindowOrOwnership(req, existing)) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: 'Edit not allowed (ownership or 48-hour window expired).' })
    }

    const items = await getOrderItems(id, client)
    const nextStatus = status ?? existing.status
    const wasBooked = existing.stock_booked && existing.status !== 'Cancelled'
    const willBeBooked = nextStatus !== 'Cancelled' && items.some((i) => i.product_code_id)

    if (wasBooked) {
      await releaseOrderItemsStock(items, client)
    }

    if (willBeBooked) {
      await reserveOrderItemsStock(items, client)
    }

    const wasOpen = existing.status !== 'Completed' && existing.status !== 'Cancelled'
    const nowClosed = nextStatus === 'Completed' || nextStatus === 'Cancelled'
    let closedAt = existing.closed_at || null
    if (wasOpen && nowClosed) {
      closedAt = new Date()
    } else if (!nowClosed) {
      closedAt = null
    } else if (nowClosed && !closedAt) {
      closedAt = existing.updated_at || new Date()
    }

    const daysValue = computeOrderDays({
      ...existing,
      status: nextStatus,
      closed_at: closedAt,
      updated_at: closedAt || existing.updated_at,
    })

    // Pending MFG follows live free stock; Completed/Cancelled force green
    let mfgOk = true
    if (nextStatus === 'Completed' || nextStatus === 'Cancelled') {
      mfgOk = true
    } else {
      mfgOk = await computeMfgOk(items, client)
    }

    const result = await client.query(
      `UPDATE orders SET
        company = COALESCE($1, company),
        state = COALESCE($2, state),
        amount = COALESCE($3, amount),
        status = COALESCE($4, status),
        stock_booked = $5,
        no_of_days = $6,
        ok_to_mfg = $7,
        closed_at = $8,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [
        company || null,
        state || null,
        amount || null,
        status || null,
        Boolean(willBeBooked),
        daysValue,
        mfgOk,
        closedAt,
        id,
      ]
    )

    await client.query('COMMIT')

    // Refresh stored monthly sold/used when an order is completed (or reopened)
    if (nextStatus === 'Completed' || existing.status === 'Completed') {
      const productIds = [
        ...new Set(items.map((it) => Number(it.product_code_id)).filter((n) => Number.isFinite(n) && n > 0)),
      ]
      for (const pid of productIds) {
        await syncProductMonthlyStats(pid).catch(() => {})
        const bom = await pool.query(
          'SELECT DISTINCT inventory_id FROM product_code_items WHERE product_code_id = $1',
          [pid]
        )
        for (const row of bom.rows) {
          await syncInventoryMonthlyStats(Number(row.inventory_id)).catch(() => {})
        }
      }
    }

    res.json(await enrichOrder(result.rows[0], items, pool))
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error updating order:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

// Customers
app.get('/api/customers', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const { search } = req.query
    let query = 'SELECT * FROM customers WHERE 1=1'
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (name ILIKE $1 OR email ILIKE $1 OR city ILIKE $1 OR state ILIKE $1 OR gst_no ILIKE $1 OR address ILIKE $1)`
    }

    query += ' ORDER BY name ASC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching customers:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/customers/:id', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Error fetching customer:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/customers/:id/orders', requireRoles(['admin', 'sales']), async (req, res) => {
  try {
    const customerRes = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id])
    if (customerRes.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    const companyName = customerRes.rows[0].name
    const { month, year } = req.query

    const allOrdersResult = await pool.query(
      `SELECT * FROM orders WHERE company ILIKE $1
       ORDER BY
         CASE WHEN order_no ~ '^FY[0-9]{2}-[0-9]{2}_' THEN 0 ELSE 1 END,
         order_no DESC,
         created_at DESC`,
      [companyName]
    )
    const allOrders = await Promise.all(
      allOrdersResult.rows.map(async (order) => {
        const items = await getOrderItems(order.id)
        return enrichOrder(order, items)
      })
    )

    let orders = allOrders
    if (month && year) {
      const m = Number(month)
      const y = Number(year)
      orders = allOrders.filter((o) => {
        const d = new Date(o.created_at)
        return !Number.isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() + 1 === m
      })
    } else if (year) {
      const y = Number(year)
      orders = allOrders.filter((o) => {
        const d = new Date(o.created_at)
        return !Number.isNaN(d.getTime()) && d.getFullYear() === y
      })
    }

    const bomRes = await pool.query(
      `SELECT pci.product_code_id, pci.inventory_id, pci.qty_per_unit, i.name AS inventory_name, COALESCE(i.sku, '') AS sku
       FROM product_code_items pci
       JOIN inventory i ON i.id = pci.inventory_id`
    )
    const bomByProduct = new Map()
    for (const row of bomRes.rows) {
      const pid = Number(row.product_code_id)
      const list = bomByProduct.get(pid) || []
      list.push({
        inventory_id: Number(row.inventory_id),
        qty_per_unit: Number(row.qty_per_unit) || 1,
        name: row.inventory_name,
        sku: row.sku,
      })
      bomByProduct.set(pid, list)
    }

    const orderRevenue = (o) => {
      const fromItems = (o.items || []).reduce((sum, it) => sum + parseAmount(it.amount), 0)
      return fromItems > 0 ? fromItems : parseAmount(o.amount)
    }
    const orderQty = (o) => {
      const fromItems = (o.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0)
      return fromItems > 0 ? fromItems : Number(o.qty) || 0
    }
    const eventDate = (o) => {
      const raw = o.closed_at || o.created_at || o.updated_at
      const d = raw ? new Date(raw) : new Date()
      return Number.isNaN(d.getTime()) ? new Date() : d
    }
    const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const now = new Date()
    const thisYm = ymKey(now)
    const fy = getFinancialYear(now)
    const fyStart = new Date(fy.startYear, 3, 1)
    const fyEnd = new Date(fy.endYear, 2, 31, 23, 59, 59)
    const inThisMonth = (o) => ymKey(eventDate(o)) === thisYm
    const inFy = (o) => {
      const d = eventDate(o)
      return d >= fyStart && d <= fyEnd
    }

    const active = allOrders.filter((o) => o.status !== 'Cancelled')
    const completedList = allOrders.filter((o) => o.status === 'Completed')
    const pendingList = allOrders.filter((o) => o.status === 'Pending')

    const completedRevenue = completedList.reduce((s, o) => s + orderRevenue(o), 0)
    const activeRevenue = active.reduce((s, o) => s + orderRevenue(o), 0)
    const revenueBase = completedRevenue > 0 ? completedRevenue : activeRevenue
    const revenueList = completedRevenue > 0 ? completedList : active

    const firstAt = active.reduce((min, o) => {
      const d = eventDate(o)
      return !min || d < min ? d : min
    }, null)
    const monthsActive = (() => {
      if (!firstAt) return 1
      return Math.max(
        1,
        (now.getFullYear() - firstAt.getFullYear()) * 12 + (now.getMonth() - firstAt.getMonth()) + 1
      )
    })()
    const fyMonthsElapsed = Math.max(1, now.getMonth() >= 3 ? now.getMonth() - 2 : now.getMonth() + 10)

    const fyRevenue = revenueList.filter(inFy).reduce((s, o) => s + orderRevenue(o), 0)
    const monthlyAvgRevenue = Math.round(revenueBase / monthsActive)
    const ordersThisMonth = allOrders.filter((o) => ymKey(new Date(o.created_at || o.closed_at || Date.now())) === thisYm).length

    const filteredRevenue = orders
      .filter((o) => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + orderRevenue(o), 0)

    // Per-product summary
    const productMap = new Map()
    for (const o of allOrders) {
      if (o.status === 'Cancelled') continue
      const lines =
        o.items?.length > 0
          ? o.items
          : [
              {
                product_code: o.product_code,
                product_name: o.product_name,
                product_code_id: o.product_code_id,
                qty: o.qty,
                amount: o.amount,
              },
            ]
      for (const it of lines) {
        const code = it.product_code || '—'
        const key = `${it.product_code_id || ''}|${code}`
        const row = productMap.get(key) || {
          product_code_id: it.product_code_id ? Number(it.product_code_id) : null,
          product_code: code,
          product_name: it.product_name || '—',
          pending_qty: 0,
          sold_qty: 0,
          lifetime_revenue: 0,
          fy_revenue: 0,
          this_month_revenue: 0,
          orders_count: 0,
          orderIds: new Set(),
          monthKeys: new Set(),
        }
        const qty = Number(it.qty) || 0
        const amt =
          parseAmount(it.amount) ||
          (lines.length === 1 ? orderRevenue(o) : 0)
        row.orderIds.add(o.id)
        if (o.status === 'Pending') row.pending_qty += qty
        if (o.status === 'Completed') {
          row.sold_qty += qty
          row.lifetime_revenue += amt
          row.monthKeys.add(ymKey(eventDate(o)))
          if (inFy(o)) row.fy_revenue += amt
          if (inThisMonth(o)) row.this_month_revenue += amt
        }
        productMap.set(key, row)
      }
    }

    const products = [...productMap.values()]
      .map((row) => {
        const activeMonths = Math.max(1, row.monthKeys.size || monthsActive)
        return {
          product_code_id: row.product_code_id,
          product_code: row.product_code,
          product_name: row.product_name,
          pending_qty: row.pending_qty,
          sold_qty: row.sold_qty,
          orders_count: row.orderIds.size,
          monthly_avg_revenue: Math.round(row.lifetime_revenue / activeMonths),
          monthly_avg_revenue_label: formatRupee(Math.round(row.lifetime_revenue / activeMonths)),
          fy_revenue: row.fy_revenue,
          fy_revenue_label: formatRupee(row.fy_revenue),
          lifetime_revenue: row.lifetime_revenue,
          lifetime_revenue_label: formatRupee(row.lifetime_revenue),
          this_month_revenue: row.this_month_revenue,
          this_month_revenue_label: formatRupee(row.this_month_revenue),
          monthly_avg_qty: Math.round((row.sold_qty / activeMonths) * 10) / 10,
          active_months: activeMonths,
        }
      })
      .sort((a, b) => b.lifetime_revenue - a.lifetime_revenue || a.product_code.localeCompare(b.product_code))

    // Per-inventory usage for this company (BOM × order qty)
    const invMap = new Map()
    for (const o of allOrders) {
      if (o.status === 'Cancelled') continue
      const lines =
        o.items?.length > 0
          ? o.items
          : [{ product_code_id: o.product_code_id, qty: o.qty }]
      for (const it of lines) {
        const pid = Number(it.product_code_id)
        if (!pid) continue
        const bom = bomByProduct.get(pid) || []
        const qty = Number(it.qty) || 0
        for (const part of bom) {
          const used = part.qty_per_unit * qty
          const row = invMap.get(part.inventory_id) || {
            inventory_id: part.inventory_id,
            name: part.name,
            sku: part.sku,
            pending_qty: 0,
            used_qty: 0,
            fy_qty: 0,
            this_month_qty: 0,
            monthKeys: new Set(),
          }
          if (o.status === 'Pending') row.pending_qty += used
          if (o.status === 'Completed') {
            row.used_qty += used
            row.monthKeys.add(ymKey(eventDate(o)))
            if (inFy(o)) row.fy_qty += used
            if (inThisMonth(o)) row.this_month_qty += used
          }
          invMap.set(part.inventory_id, row)
        }
      }
    }

    const inventory = [...invMap.values()]
      .map((row) => {
        const activeMonths = Math.max(1, row.monthKeys.size || monthsActive)
        return {
          inventory_id: row.inventory_id,
          name: row.name,
          sku: row.sku,
          pending_qty: row.pending_qty,
          used_qty: row.used_qty,
          this_month_qty: row.this_month_qty,
          fy_qty: row.fy_qty,
          lifetime_qty: row.used_qty,
          monthly_avg_qty: Math.round((row.used_qty / activeMonths) * 10) / 10,
          active_months: activeMonths,
        }
      })
      .sort((a, b) => b.used_qty - a.used_qty || a.name.localeCompare(b.name))

    res.json({
      customer: customerRes.rows[0],
      orders,
      products,
      inventory,
      stats: {
        totalOrders: allOrders.length,
        pendingOrders: pendingList.length,
        completedOrders: completedList.length,
        ordersThisMonth,
        monthly_avg_revenue: formatRupee(monthlyAvgRevenue),
        monthly_avg_revenue_raw: monthlyAvgRevenue,
        fy_label: `FY ${fy.label}`,
        fy_revenue: formatRupee(fyRevenue),
        fy_revenue_raw: fyRevenue,
        totalRevenue: formatRupee(activeRevenue),
        lifetime_revenue_raw: activeRevenue,
        months_active: monthsActive,
        fy_months_elapsed: fyMonthsElapsed,
        filteredRevenue: formatRupee(filteredRevenue),
        filteredOrders: orders.length,
      },
    })
  } catch (error) {
    console.error('Error fetching customer orders:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/customers', requireRoles(['admin', 'sales']), async (req, res) => {
  const { name, email, phone, city, state, gst_no, address } = req.body

  if (!name || !city || !state) {
    return res.status(400).json({ message: 'Company name, city, and state are required.' })
  }

  try {
    const emailVal = String(email || '').trim() || '-'
    const phoneVal = String(phone || '').trim() || '-'
    const result = await pool.query(
      `INSERT INTO customers (name, email, phone, city, state, orders_count, total_amount, gst_no, address, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, emailVal, phoneVal, city, state, 0, '₹ 0', gst_no || '', address || '', req.user.id]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating customer:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/customers/:id', requireRoles(['admin', 'sales']), async (req, res) => {
  const { id } = req.params
  const { name, email, phone, city, state, gst_no, address } = req.body
  const isAdmin = req.user?.role === 'admin'

  try {
    const existing = await pool.query('SELECT created_by, created_at FROM customers WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    if (!enforceEditWindowOrOwnership(req, existing.rows[0])) {
      return res.status(403).json({ message: 'Edit not allowed (ownership or 48-hour window expired).' })
    }

    // Non-admin can only edit company name
    if (!isAdmin) {
      if (!name) {
        return res.status(400).json({ message: 'Name is required.' })
      }
      const result = await pool.query(
        'UPDATE customers SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [name, id]
      )
      return res.json(result.rows[0])
    }

    const result = await pool.query(
      `UPDATE customers SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         phone = COALESCE($3, phone),
         city = COALESCE($4, city),
         state = COALESCE($5, state),
         gst_no = COALESCE($6, gst_no),
         address = COALESCE($7, address),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [name, email, phone, city, state, gst_no, address, id]
    )

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating customer:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Products
app.get('/api/products', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const { search, category } = req.query
    let query = 'SELECT * FROM products WHERE 1=1'
    const params = []

    if (category) {
      params.push(category)
      query += ` AND category = $${params.length}`
    }
    if (search) {
      params.push(`%${search}%`)
      query += ` AND (name ILIKE $${params.length} OR sku ILIKE $${params.length} OR product_id ILIKE $${params.length})`
    }

    query += ' ORDER BY created_at DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching products:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/products', requireRoles(['admin']), async (req, res) => {
  const { name, sku, category, price, stock } = req.body

  if (!name || !sku || !category || !price) {
    return res.status(400).json({ message: 'Name, SKU, category, and price are required.' })
  }

  try {
    const productId = `P${String(Date.now()).slice(-6)}`
    const stockLevel = Number(stock) || 0
    const productStatus = stockLevel <= 20 ? 'Low Stock' : 'In Stock'

    const result = await pool.query(
      'INSERT INTO products (product_id, name, category, sku, price, stock, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [productId, name, category, sku, price, stockLevel, productStatus]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating product:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/products/:id', requireRoles(['admin']), async (req, res) => {
  const { id } = req.params
  const { name, sku, category, price, stock, status } = req.body

  try {
    const result = await pool.query(
      'UPDATE products SET name = COALESCE($1, name), sku = COALESCE($2, sku), category = COALESCE($3, category), price = COALESCE($4, price), stock = COALESCE($5, stock), status = COALESCE($6, status) WHERE id = $7 RETURNING *',
      [name, sku, category, price, stock != null ? Number(stock) : null, status, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating product:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Inventory
app.get('/api/inventory', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  try {
    const { status, search } = req.query
    let query = `
      SELECT i.*,
        COALESCE((
          SELECT SUM(pci.qty_per_unit * oi.qty)::int
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id
            AND o.status = 'Pending'
        ), 0)::int AS sales_required,
        COALESCE((
          SELECT SUM(pci.qty_per_unit * oi.qty)::int
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id
            AND o.status = 'Completed'
        ), 0)::int AS qty_used,
        COALESCE((
          SELECT COALESCE(SUM(pci.qty_per_unit * oi.qty), 0)::float
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id
            AND o.status = 'Completed'
            AND TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') =
                TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')
        ), 0)::float AS monthly_avg
      FROM inventory i
      WHERE 1=1`
    const params = []

    if (status) {
      params.push(status)
      query += ` AND i.status = $${params.length}`
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`)
      query += ` AND (LOWER(i.name) LIKE $${params.length} OR LOWER(COALESCE(i.sku, '')) LIKE $${params.length})`
    }

    query += ' ORDER BY i.name ASC'
    const result = await pool.query(query, params)
    const target = await getLowStockTarget()
    res.json(result.rows.map((row) => mapInventoryRow(row, target)))
  } catch (error) {
    console.error('Error fetching inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/inventory', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { name, available, pending, reserved, status, rate, stock_target } = req.body

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Inventory name is required.' })
  }

  try {
    const avail = Number(available) || 0
    const pend = Number(pending) || 0
    const resv = Number(reserved) || 0
    const rateVal = Number(rate) || 0
    const itemTarget =
      stock_target === '' || stock_target == null ? null : Math.max(0, Number(stock_target) || 0)
    const globalTarget = await getLowStockTarget()
    const effective = itemTarget != null ? itemTarget : globalTarget
    const itemStatus = status || inventoryStatus(avail, 0, effective)
    const base = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    const sku = `${base || 'ITEM'}-${Date.now().toString().slice(-4)}`

    const result = await pool.query(
      `INSERT INTO inventory (name, sku, available, pending, reserved, required_qty, status, rate, stock_target, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, CURRENT_TIMESTAMP) RETURNING *`,
      [name.trim(), sku, avail, pend, resv, itemStatus, rateVal, itemTarget, req.user.id]
    )

    if (rateVal > 0) {
      await recordInventoryRate(result.rows[0].id, rateVal, req.user.id, 'Initial rate')
    }

    res.status(201).json(mapInventoryRow({ ...result.rows[0], sales_required: 0, monthly_avg: 0 }, globalTarget))
  } catch (error) {
    console.error('Error creating inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/inventory/:id', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const { available, reserved, status, name, rate, stock_target } = req.body

  try {
    const existing = await pool.query('SELECT * FROM inventory WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    if (!enforceEditWindowOrOwnership(req, existing.rows[0])) {
      return res.status(403).json({ message: 'Edit not allowed (ownership or 48-hour window expired).' })
    }

    const avail = available != null ? Number(available) : existing.rows[0].available
    const booked = await getBookedQtyForInventory(id)
    const globalTarget = await getLowStockTarget()

    let nextTarget = existing.rows[0].stock_target
    if (stock_target !== undefined) {
      nextTarget =
        stock_target === '' || stock_target == null ? null : Math.max(0, Number(stock_target) || 0)
    }

    const rateProvided = rate !== undefined && rate !== null && rate !== ''
    const nextRate = rateProvided ? Number(rate) || 0 : Number(existing.rows[0].rate) || 0
    const prevRate = Number(existing.rows[0].rate) || 0

    const effective = resolveItemTarget({ stock_target: nextTarget }, globalTarget)
    const autoStatus = status || inventoryStatus(avail, booked, effective)

    const result = await pool.query(
      `UPDATE inventory SET
        name = COALESCE($1, name),
        available = COALESCE($2, available),
        pending = $3,
        reserved = COALESCE($4, reserved),
        status = $5,
        rate = $6,
        stock_target = $7,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [
        name != null ? String(name).trim() : null,
        available != null ? Number(available) : null,
        booked,
        reserved != null ? Number(reserved) : null,
        autoStatus,
        nextRate,
        nextTarget,
        id,
      ]
    )

    if (rateProvided && nextRate !== prevRate) {
      await recordInventoryRate(id, nextRate, req.user.id, 'Rate updated')
    }

    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }, globalTarget))
  } catch (error) {
    console.error('Error updating inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Add or subtract qty available (stock in / stock out). Booked from sales is unchanged. */
app.post('/api/inventory/:id/adjust', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const delta = Number(req.body?.delta)
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ message: 'Provide a non-zero delta (e.g. +5 or -3).' })
  }

  try {
    const existing = await pool.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    const avail = Number(existing.rows[0].available) + delta
    const booked = await getBookedQtyForInventory(id)
    const globalTarget = await getLowStockTarget()
    const target = resolveItemTarget(existing.rows[0], globalTarget)
    const autoStatus = inventoryStatus(avail, booked, target)

    const result = await pool.query(
      `UPDATE inventory SET
        available = $1,
        pending = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [avail, booked, autoStatus, id]
    )

    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }, globalTarget))
  } catch (error) {
    console.error('Error adjusting inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Bookings for an inventory part: sales orders + manual add-qty movements */
app.get('/api/inventory/:id/bookings', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const inv = await pool.query('SELECT id, name FROM inventory WHERE id = $1', [id])
    if (inv.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    const sales = await pool.query(
      `SELECT
         o.order_no,
         oi.product_code,
         (pci.qty_per_unit * oi.qty)::int AS qty,
         COALESCE(o.date, TO_CHAR(o.created_at, 'DD Mon YYYY')) AS date,
         o.status,
         'order' AS source,
         o.created_at
       FROM product_code_items pci
       JOIN order_items oi ON oi.product_code_id = pci.product_code_id
       JOIN orders o ON o.id = oi.order_id
       WHERE pci.inventory_id = $1
         AND o.status <> 'Cancelled'
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [id]
    )

    const moves = await pool.query(
      `SELECT
         COALESCE(order_no, '') AS order_no,
         COALESCE(product_code, '') AS product_code,
         qty,
         movement_date AS date,
         'Added' AS status,
         'manual' AS source,
         created_at
       FROM inventory_movements
       WHERE inventory_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id]
    )

    const bookings = [...sales.rows, ...moves.rows].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime()
      const tb = new Date(b.created_at || 0).getTime()
      return tb - ta
    })

    res.json({
      inventory: inv.rows[0],
      bookings: bookings.map((b) => ({
        order_no: b.order_no || '—',
        product_code: b.product_code || '—',
        qty: Number(b.qty) || 0,
        date: b.date || '—',
        status: b.status,
        source: b.source,
      })),
    })
  } catch (error) {
    console.error('Error fetching inventory bookings:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Stored monthly used-qty history for one inventory part (resets each calendar month). */
app.get('/api/inventory/:id/monthly-stats', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const inv = await pool.query('SELECT id, name FROM inventory WHERE id = $1', [id])
    if (inv.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }
    await syncInventoryMonthlyStats(Number(id))
    const months = await getStoredMonthlyStats('inventory', Number(id))
    const thisMonth = currentYearMonth()
    res.json({
      inventory: inv.rows[0],
      metric: 'used',
      current_month: thisMonth,
      current_label: formatYearMonthLabel(thisMonth),
      monthly_avg: months.find((m) => m.is_current)?.qty ?? 0,
      months,
    })
  } catch (error) {
    console.error('Error fetching inventory monthly stats:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Last 5 rates (queue) for an inventory item */
app.get('/api/inventory/:id/rates', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const inv = await pool.query('SELECT id, name, rate FROM inventory WHERE id = $1', [id])
    if (inv.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }
    const rates = await getInventoryRateHistory(id)
    res.json({
      inventory: {
        id: inv.rows[0].id,
        name: inv.rows[0].name,
        rate: Number(inv.rows[0].rate) || 0,
      },
      rates,
    })
  } catch (error) {
    console.error('Error fetching inventory rates:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Full inventory summary: stats, per-company, monthly, history */
app.get('/api/inventory/:id/summary', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const invRes = await pool.query(
      `SELECT id, name, sku, available, pending, reserved, status, rate, stock_target
       FROM inventory WHERE id = $1`,
      [id]
    )
    if (invRes.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    const inventoryId = Number(id)
    await syncInventoryMonthlyStats(inventoryId)
    const months = await getStoredMonthlyStats('inventory', inventoryId)
    const booked = await getBookedQtyForInventory(inventoryId)
    const globalTarget = await getLowStockTarget()
    const target = resolveItemTarget(invRes.rows[0], globalTarget)
    const rateHistory = await getInventoryRateHistory(inventoryId)

    const now = new Date()
    const fy = getFinancialYear(now)
    const thisYm = currentYearMonth()
    const fyStart = new Date(fy.startYear, 3, 1)
    const fyEnd = new Date(fy.endYear, 2, 31, 23, 59, 59)

    const usageRes = await pool.query(
      `SELECT
         o.id AS order_id,
         o.company,
         o.order_no,
         o.status,
         oi.product_code,
         oi.product_name,
         (pci.qty_per_unit * oi.qty)::int AS qty,
         COALESCE(o.closed_at, o.created_at) AS event_at,
         COALESCE(o.date, TO_CHAR(o.created_at, 'DD Mon YYYY')) AS date,
         o.created_at
       FROM product_code_items pci
       JOIN order_items oi ON oi.product_code_id = pci.product_code_id
       JOIN orders o ON o.id = oi.order_id
       WHERE pci.inventory_id = $1
         AND o.status <> 'Cancelled'
       ORDER BY COALESCE(o.closed_at, o.created_at) DESC`,
      [inventoryId]
    )

    const movesRes = await pool.query(
      `SELECT
         COALESCE(order_no, 'Inward') AS order_no,
         COALESCE(product_code, '') AS product_code,
         qty::int AS qty,
         movement_date AS date,
         'Added' AS status,
         'manual' AS source,
         created_at
       FROM inventory_movements
       WHERE inventory_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [inventoryId]
    )

    const linkedProducts = await pool.query(
      `SELECT pc.id, pc.code, pc.name, pci.qty_per_unit
       FROM product_code_items pci
       JOIN product_codes pc ON pc.id = pci.product_code_id
       WHERE pci.inventory_id = $1
       ORDER BY pc.code`,
      [inventoryId]
    )

    const eventDate = (row) => {
      const d = new Date(row.event_at || row.created_at)
      return Number.isNaN(d.getTime()) ? new Date() : d
    }
    const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const inFy = (d) => d >= fyStart && d <= fyEnd

    const lines = usageRes.rows
    const completed = lines.filter((r) => r.status === 'Completed')
    const pending = lines.filter((r) => r.status === 'Pending')

    const usedQty = completed.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const pendingQty = pending.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const fyUsed = completed.filter((r) => inFy(eventDate(r))).reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const thisMonthUsed = completed
      .filter((r) => ymKey(eventDate(r)) === thisYm)
      .reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const monthKeys = new Set(completed.map((r) => ymKey(eventDate(r))))
    const monthsActive = Math.max(1, monthKeys.size || 1)
    const monthlyAvgQty = Math.round((usedQty / monthsActive) * 10) / 10
    const customers = new Set(lines.map((r) => String(r.company || '').trim().toLowerCase()).filter(Boolean))
    const inwardQty = movesRes.rows
      .filter((m) => Number(m.qty) > 0)
      .reduce((s, m) => s + (Number(m.qty) || 0), 0)

    const companyMap = new Map()
    for (const r of lines) {
      const name = r.company || '—'
      const key = name.toLowerCase()
      const row = companyMap.get(key) || {
        company: name,
        orderIds: new Set(),
        pending_qty: 0,
        used_qty: 0,
        fy_qty: 0,
        this_month_qty: 0,
        monthKeys: new Set(),
        products: new Set(),
      }
      row.orderIds.add(r.order_id)
      const qty = Number(r.qty) || 0
      const d = eventDate(r)
      if (r.product_code) row.products.add(r.product_code)
      if (r.status === 'Pending') row.pending_qty += qty
      if (r.status === 'Completed') {
        row.used_qty += qty
        row.monthKeys.add(ymKey(d))
        if (inFy(d)) row.fy_qty += qty
        if (ymKey(d) === thisYm) row.this_month_qty += qty
      }
      companyMap.set(key, row)
    }

    const companies = [...companyMap.values()]
      .map((row) => {
        const active = Math.max(1, row.monthKeys.size || 1)
        return {
          company: row.company,
          orders_count: row.orderIds.size,
          products_count: row.products.size,
          pending_qty: row.pending_qty,
          used_qty: row.used_qty,
          monthly_avg_qty: Math.round((row.used_qty / active) * 10) / 10,
          fy_qty: row.fy_qty,
          lifetime_qty: row.used_qty,
          this_month_qty: row.this_month_qty,
        }
      })
      .sort((a, b) => b.used_qty - a.used_qty || a.company.localeCompare(b.company))

    const history = [
      ...movesRes.rows.map((m) => ({
        kind: Number(m.qty) >= 0 ? 'inward' : 'stock',
        company: Number(m.qty) >= 0 ? 'Inward / Stock' : 'Stock move',
        order_no: m.order_no || '—',
        product_code: m.product_code || '—',
        qty: Number(m.qty) || 0,
        date: m.date || '—',
        status: m.status || 'Added',
        sortAt: m.created_at ? new Date(m.created_at).getTime() : 0,
      })),
      ...lines.map((r) => ({
        kind: 'order',
        company: r.company || '—',
        order_no: r.order_no || '—',
        product_code: r.product_code || '—',
        qty: Number(r.qty) || 0,
        date: r.date || '—',
        status: r.status || '—',
        sortAt: r.created_at ? new Date(r.created_at).getTime() : 0,
      })),
    ].sort((a, b) => b.sortAt - a.sortAt)

    const row = invRes.rows[0]
    res.json({
      inventory: {
        ...row,
        available: Number(row.available) || 0,
        rate: Number(row.rate) || 0,
        stock_target: row.stock_target != null ? Number(row.stock_target) : null,
        effective_target: target,
        required_qty: booked,
        status: inventoryStatus(Number(row.available) || 0, booked, target),
      },
      stats: {
        available: Number(row.available) || 0,
        required_qty: booked,
        pending_qty: pendingQty,
        used_qty: usedQty,
        customers_count: customers.size,
        orders_count: new Set(lines.map((r) => r.order_id)).size,
        this_month_qty: thisMonthUsed,
        monthly_avg_qty: monthlyAvgQty,
        fy_label: `FY ${fy.label}`,
        fy_qty: fyUsed,
        lifetime_qty: usedQty,
        inward_qty: inwardQty,
        months_active: monthsActive,
        rate: Number(row.rate) || 0,
        stock_target: row.stock_target != null ? Number(row.stock_target) : null,
        effective_target: target,
      },
      companies,
      products: linkedProducts.rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        qty_per_unit: Number(p.qty_per_unit) || 1,
      })),
      months,
      rates: rateHistory,
      history,
    })
  } catch (error) {
    console.error('Error fetching inventory summary:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Add qty (inward stock). Defaults label to Inward. */
app.post('/api/inventory/:id/add-qty', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const qty = Number(req.body?.qty)
  const orderNo =
    String(req.body?.inward || req.body?.order_no || 'Inward').trim() || 'Inward'
  const productCode = String(req.body?.product_code || '').trim()
  const date =
    String(req.body?.date || '').trim() ||
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  if (!Number.isFinite(qty) || qty === 0) {
    return res.status(400).json({ message: 'Enter a non-zero qty to add.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [id])
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'Item not found' })
    }

    const avail = Number(existing.rows[0].available) + qty
    const booked = await getBookedQtyForInventory(id, client)
    const globalTarget = await getLowStockTarget(client)
    const target = resolveItemTarget(existing.rows[0], globalTarget)
    const autoStatus = inventoryStatus(avail, booked, target)

    const result = await client.query(
      `UPDATE inventory SET
        available = $1,
        pending = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [avail, booked, autoStatus, id]
    )

    await client.query(
      `INSERT INTO inventory_movements (inventory_id, order_no, product_code, qty, movement_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, orderNo, productCode, qty, date, req.user.id]
    )

    await client.query('COMMIT')
    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }, globalTarget))
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error adding inventory qty:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

// CSV / StkSum import — Particulars-only supported (qty/rate/value ignored when namesOnly or no qty)
app.post('/api/inventory/import', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { rows, namesOnly } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors = []
  const target = await getLowStockTarget()

  const makeSku = (name, index) => {
    const base = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    return `${base || 'ITEM'}-${String(index).padStart(3, '0')}`
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = String(row.Particulars || row.particulars || row.name || row.Name || '').trim()
      if (!name) {
        errors.push(`Row ${i + 1}: Particulars/name required`)
        continue
      }
      if (/^\d+$/.test(name) || /^grand total$/i.test(name)) {
        skipped++
        continue
      }

      const existing = await pool.query('SELECT id, available FROM inventory WHERE LOWER(name) = LOWER($1) LIMIT 1', [
        name,
      ])

      const availFromRow = Number(row.available ?? row.qty ?? row.Quantity)
      const hasQty = !namesOnly && Number.isFinite(availFromRow)

      if (existing.rows[0]) {
        if (hasQty) {
          const avail = availFromRow
          const booked = await getBookedQtyForInventory(existing.rows[0].id)
          const status = inventoryStatus(avail, booked, target)
          await pool.query(
            `UPDATE inventory SET available = $1, pending = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
            [avail, booked, status, existing.rows[0].id]
          )
          updated++
        } else {
          skipped++
        }
        continue
      }

      const avail = hasQty ? availFromRow : 0
      const sku = String(row.sku || row.SKU || '').trim() || makeSku(name, i + 1)
      const status = inventoryStatus(avail, 0, target)

      await pool.query(
        'INSERT INTO inventory (name, sku, available, pending, reserved, required_qty, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [name, sku, avail, 0, 0, 0, status, req.user.id]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, updated, skipped, total: rows.length, errors })
})

/** Remove inventory rows that are actually product names (StkSum wrongly imported into inventory). Keeps BOM-linked parts. */
app.post('/api/inventory/cleanup-products', requireRoles(['admin', 'inventory']), async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM inventory i
      WHERE EXISTS (
        SELECT 1 FROM product_codes pc
        WHERE LOWER(TRIM(pc.name)) = LOWER(TRIM(i.name))
           OR LOWER(TRIM(COALESCE(pc.description, ''))) = LOWER(TRIM(i.name))
           OR LOWER(TRIM(pc.code)) = LOWER(TRIM(i.name))
      )
      AND NOT EXISTS (
        SELECT 1 FROM product_code_items pci WHERE pci.inventory_id = i.id
      )
      RETURNING i.id, i.name
    `)
    res.json({
      deleted: result.rowCount || 0,
      names: result.rows.map((r) => r.name).slice(0, 50),
    })
  } catch (error) {
    console.error('Inventory cleanup error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/customers/import', requireRoles(['admin', 'sales']), async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  const dash = (v) => {
    const s = String(v ?? '').trim()
    return s || '-'
  }
  const clip = (v, n) => {
    const s = dash(v)
    return s.length > n ? s.slice(0, n) : s
  }
  const normalizePhone = (raw) => {
    const s = String(raw ?? '').trim()
    if (!s) return '-'
    const match = s.replace(/\s+/g, ' ').match(/[\d+][\d\s\-()/]{6,}/)
    const phone = match ? match[0].replace(/\s+/g, '') : s
    return clip(phone, 50)
  }

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors = []
  const seen = new Set()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = clip(
        row.name || row['Company name'] || row['Company Name'] || row.Name || '',
        255
      )
      if (!name || name === '-' || /^sl\s*no\.?$/i.test(name)) {
        skipped++
        continue
      }
      const key = name.toLowerCase()
      if (seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)

      const address = dash(row.address || row.Address)
      const state = clip(row.state || row.State || '-', 100)
      let city = String(row.city || row.City || '').trim()
      if (!city && address && address !== '-') {
        const parts = address
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
        const last = parts[parts.length - 1] || ''
        city = last.replace(/\d{5,6}/g, '').replace(/-/g, ' ').trim() || state
      }
      city = clip(city || state, 100)
      const gst = clip(row.gst_no || row['GSTIN/UIN'] || row.GSTIN || row.GST || '-', 50)

      // Never invent emails — blank in Excel → "-"
      let emailRaw = String(row.email || row.Email || row['E-mail'] || '').trim()
      if (/@import\.local$/i.test(emailRaw)) emailRaw = ''
      const email = clip(emailRaw || '-', 255)

      const phone = normalizePhone(
        row.phone ||
          row.Phone ||
          row['Mobile No.'] ||
          row['Mobile No'] ||
          row.Mobile ||
          row['Telephone No.'] ||
          row['Telephone No'] ||
          row.Telephone ||
          ''
      )

      const existing = await pool.query(
        'SELECT id FROM customers WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [name]
      )

      if (existing.rows[0]) {
        await pool.query(
          `UPDATE customers SET
            email = $1,
            phone = $2,
            city = $3,
            state = $4,
            gst_no = CASE WHEN $5 = '-' THEN '' ELSE $5 END,
            address = CASE WHEN $6 = '-' THEN '' ELSE $6 END,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $7`,
          [email, phone, city, state, gst, address, existing.rows[0].id]
        )
        updated++
      } else {
        await pool.query(
          `INSERT INTO customers (name, email, phone, city, state, orders_count, total_amount, gst_no, address, created_by)
           VALUES ($1, $2, $3, $4, $5, 0, '₹ 0', $6, $7, $8)`,
          [
            name,
            email,
            phone,
            city,
            state,
            gst === '-' ? '' : gst,
            address === '-' ? '' : address,
            req.user.id,
          ]
        )
        imported++
      }
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, updated, skipped, total: rows.length, errors })
})
app.post('/api/products/import', requireRoles(['admin']), async (req, res) => {
  const { rows, namesOnly } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  let skipped = 0
  const errors = []

  const makeSku = (name, index) => {
    const base = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    return `${base || 'ITEM'}-${String(index).padStart(3, '0')}`
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = String(row.Particulars || row.particulars || row.name || row.Name || '').trim()
      if (!name) {
        errors.push(`Row ${i + 1}: Particulars/name required`)
        continue
      }
      if (/^\d+$/.test(name) || /^grand total$/i.test(name)) {
        skipped++
        continue
      }

      const existing = await pool.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])
      if (existing.rows[0]) {
        skipped++
        continue
      }

      const sku = String(row.sku || row.SKU || '').trim() || makeSku(name, i + 1)
      const category = namesOnly ? 'General' : String(row.category || 'General')
      const price = namesOnly ? '₹ 0' : String(row.price || '₹ 0')
      const stock = namesOnly ? 0 : Number(row.stock) || 0
      const productId = row.product_id || `P${String(Date.now()).slice(-6)}${i}`
      const status = stock <= 20 && stock > 0 ? 'Low Stock' : stock <= 0 ? 'In Stock' : 'In Stock'

      await pool.query(
        'INSERT INTO products (product_id, name, category, sku, price, stock, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [productId, name, category, sku, price, stock, status]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, skipped, total: rows.length, errors })
})

/** Import StkSum / product names into product_codes (Particulars → product + stock qty) */
app.post('/api/product-codes/import', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors = []
  const seen = new Set()

  const skipName = (name) => {
    if (!name) return true
    if (/^\d+$/.test(name)) return true
    if (/^grand total$/i.test(name)) return true
    if (/^stock$/i.test(name)) return true
    if (/^material\s*@/i.test(name)) return true
    if (/^particulars$/i.test(name)) return true
    return false
  }

  const makeCode = (name, index) => {
    const base = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
    return `${base || 'PRD'}-${String(index).padStart(3, '0')}`
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = String(row.Particulars || row.particulars || row.name || row.Name || '').trim()
      if (skipName(name)) {
        skipped++
        continue
      }
      const key = name.toLowerCase()
      if (seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)

      const stockRaw = Number(row.available ?? row.qty ?? row.Quantity ?? row.stock)
      const stockQty = Number.isFinite(stockRaw) ? Math.max(0, Math.round(Math.abs(stockRaw))) : 0

      const existing = await pool.query(
        'SELECT id, code FROM product_codes WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [name]
      )

      if (existing.rows[0]) {
        await pool.query(
          `UPDATE product_codes
           SET stock_qty = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [stockQty, existing.rows[0].id]
        )
        updated++
        continue
      }

      let code = String(row.code || '').trim().toUpperCase() || makeCode(name, i + 1)
      // Ensure unique code
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = await pool.query('SELECT id FROM product_codes WHERE LOWER(code) = LOWER($1) LIMIT 1', [
          code,
        ])
        if (!clash.rows[0]) break
        code = makeCode(name, i + 1 + attempt * 17 + Date.now() % 97)
      }

      await pool.query(
        `INSERT INTO product_codes (code, name, description, stock_qty, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [code, name, '', stockQty, req.user.id]
      )
      imported++
    } catch (e) {
      if (e.code === '23505') {
        skipped++
        continue
      }
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, updated, skipped, total: rows.length, errors })
})

app.post('/api/orders/import', requireRoles(['admin', 'sales']), async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  const errors = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const company = row.company
      const state = row.state
      const qty = Number(row.qty)
      const amount = row.amount
      if (!company || !state || !qty || !amount) {
        errors.push(`Row ${i + 1}: company, state, qty, amount required`)
        continue
      }
      const orderNo = row.order_no || (await nextOrderNo(pool))
      const date = row.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const status = row.status || 'Pending'
      await pool.query(
        `INSERT INTO orders (order_no, company, state, date, qty, amount, status, created_by, product_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orderNo, company, state, date, qty, amount, status, req.user.id, row.product_code || null]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, total: rows.length, errors })
})

// Product Codes
app.get('/api/product-codes', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  try {
    const codes = await pool.query('SELECT * FROM product_codes ORDER BY code ASC')
    if (codes.rows.length === 0) {
      return res.json([])
    }

    // Batch: all BOM items + inventory booked (one query, not per product)
    const itemsRes = await pool.query(
      `SELECT pci.product_code_id, pci.id, pci.qty_per_unit,
              i.id AS inventory_id, i.name, i.sku,
              i.available, i.pending, i.reserved, i.required_qty, i.status,
              COALESCE((
                SELECT SUM(pci2.qty_per_unit * oi.qty)::int
                FROM product_code_items pci2
                JOIN order_items oi ON oi.product_code_id = pci2.product_code_id
                JOIN orders o ON o.id = oi.order_id
                WHERE pci2.inventory_id = i.id AND o.status = 'Pending'
              ), 0)::int AS booked
       FROM product_code_items pci
       JOIN inventory i ON i.id = pci.inventory_id
       ORDER BY i.name`
    )

    // Batch: booked / sold / monthly avg per product
    const statsRes = await pool.query(
      `SELECT
         oi.product_code_id,
         COALESCE(SUM(oi.qty) FILTER (WHERE o.status = 'Pending'), 0)::int AS booked,
         COALESCE(SUM(oi.qty) FILTER (WHERE o.status = 'Completed'), 0)::int AS sold,
         COALESCE(
           SUM(oi.qty) FILTER (
             WHERE o.status = 'Completed'
               AND TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') =
                   TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')
           ),
           0
         )::float AS monthly_avg
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id IS NOT NULL
       GROUP BY oi.product_code_id`
    )

    const itemsByCode = new Map()
    for (const row of itemsRes.rows) {
      const list = itemsByCode.get(row.product_code_id) || []
      const booked = Number(row.booked) || 0
      list.push({
        ...row,
        available: Number(row.available) || 0,
        booked,
        pending: booked,
        required_qty: booked,
      })
      itemsByCode.set(row.product_code_id, list)
    }

    const statsByCode = new Map()
    for (const row of statsRes.rows) {
      statsByCode.set(row.product_code_id, {
        booked: Number(row.booked) || 0,
        sold: Number(row.sold) || 0,
        monthly_avg: Number(row.monthly_avg) || 0,
      })
    }

    const withItems = codes.rows.map((code) => {
      const items = itemsByCode.get(code.id) || []
      const stats = statsByCode.get(code.id) || { booked: 0, sold: 0, monthly_avg: 0 }
      const stockQty = Math.max(0, Number(code.stock_qty) || 0)
      return {
        ...code,
        stock_qty: stockQty,
        items,
        qty_available: stockQty,
        booked: stats.booked,
        required_qty: stats.booked,
        sold: stats.sold,
        monthly_avg: stats.monthly_avg,
      }
    })

    res.json(withItems)
  } catch (error) {
    console.error('Error fetching product codes:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/product-codes/:id/bookings', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const codeRes = await pool.query('SELECT id, code, name FROM product_codes WHERE id = $1', [id])
    if (codeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product code not found.' })
    }

    const sales = await pool.query(
      `SELECT
         o.company,
         o.order_no,
         oi.qty::int AS qty,
         COALESCE(o.date, TO_CHAR(o.created_at, 'DD Mon YYYY')) AS date,
         o.status,
         o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id = $1
         AND o.status <> 'Cancelled'
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [id]
    )

    const stockAdds = await pool.query(
      `SELECT
         label,
         qty::int AS qty,
         stock_after::int AS stock_after,
         movement_date AS date,
         note,
         created_at
       FROM product_stock_movements
       WHERE product_code_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id]
    )

    res.json({
      product: codeRes.rows[0],
      bookings: sales.rows.map((b) => ({
        type: 'order',
        company: b.company || '—',
        order_no: b.order_no || '—',
        qty: Number(b.qty) || 0,
        date: b.date || '—',
        status: b.status,
        created_at: b.created_at,
      })),
      stock_history: stockAdds.rows.map((m) => ({
        type: 'stock',
        label: m.label || 'Stock',
        qty: Number(m.qty) || 0,
        stock_after: Number(m.stock_after) || 0,
        date: m.date || '—',
        note: m.note || '',
        created_at: m.created_at,
      })),
    })
  } catch (error) {
    console.error('Error fetching product bookings:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Full product summary page: stats, per-company, monthly, history */
app.get('/api/product-codes/:id/summary', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const codeRes = await pool.query(
      `SELECT id, code, name, description, COALESCE(stock_qty, 0)::int AS stock_qty
       FROM product_codes WHERE id = $1`,
      [id]
    )
    if (codeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product code not found.' })
    }

    const productId = Number(id)
    const items = await getProductCodeItems(productId)
    await syncProductMonthlyStats(productId)
    const months = await getStoredMonthlyStats('product', productId)

    const now = new Date()
    const fy = getFinancialYear(now)
    const fyStart = `${fy.startYear}-04-01`
    const fyEnd = `${fy.endYear}-03-31`
    const thisYm = currentYearMonth()

    const linesRes = await pool.query(
      `SELECT
         o.id AS order_id,
         o.company,
         o.order_no,
         o.status,
         oi.qty::int AS qty,
         oi.amount,
         COALESCE(o.closed_at, o.created_at) AS event_at,
         COALESCE(o.date, TO_CHAR(o.created_at, 'DD Mon YYYY')) AS date,
         o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id = $1
         AND o.status <> 'Cancelled'
       ORDER BY COALESCE(o.closed_at, o.created_at) DESC`,
      [productId]
    )

    const stockAdds = await pool.query(
      `SELECT label, qty::int AS qty, stock_after::int AS stock_after, movement_date AS date, created_at
       FROM product_stock_movements
       WHERE product_code_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [productId]
    )

    const parseAmt = (v) => parseAmount(v)
    const eventDate = (row) => {
      const d = new Date(row.event_at || row.created_at)
      return Number.isNaN(d.getTime()) ? new Date() : d
    }
    const inFy = (d) => {
      const a = new Date(fy.startYear, 3, 1)
      const b = new Date(fy.endYear, 2, 31, 23, 59, 59)
      return d >= a && d <= b
    }
    const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const lines = linesRes.rows
    const completed = lines.filter((r) => r.status === 'Completed')
    const pending = lines.filter((r) => r.status === 'Pending')

    const soldQty = completed.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const pendingQty = pending.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const lifetimeRevenue = completed.reduce((s, r) => s + parseAmt(r.amount), 0)
    const fyCompleted = completed.filter((r) => inFy(eventDate(r)))
    const fyQty = fyCompleted.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const fyRevenue = fyCompleted.reduce((s, r) => s + parseAmt(r.amount), 0)
    const thisMonthCompleted = completed.filter((r) => ymKey(eventDate(r)) === thisYm)
    const thisMonthQty = thisMonthCompleted.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    const thisMonthRevenue = thisMonthCompleted.reduce((s, r) => s + parseAmt(r.amount), 0)

    const monthKeys = new Set(completed.map((r) => ymKey(eventDate(r))))
    const monthsActive = Math.max(1, monthKeys.size || 1)
    const monthlyAvgQty = Math.round((soldQty / monthsActive) * 10) / 10
    const monthlyAvgRevenue = Math.round(lifetimeRevenue / monthsActive)
    const customers = new Set(lines.map((r) => String(r.company || '').trim().toLowerCase()).filter(Boolean))

    // Per-company rollup
    const companyMap = new Map()
    for (const r of lines) {
      const name = r.company || '—'
      const key = name.toLowerCase()
      const row = companyMap.get(key) || {
        company: name,
        orders_count: 0,
        orderIds: new Set(),
        pending_qty: 0,
        sold_qty: 0,
        lifetime_revenue: 0,
        fy_qty: 0,
        fy_revenue: 0,
        this_month_qty: 0,
        monthKeys: new Set(),
      }
      row.orderIds.add(r.order_id)
      const qty = Number(r.qty) || 0
      const amt = parseAmt(r.amount)
      const d = eventDate(r)
      if (r.status === 'Pending') row.pending_qty += qty
      if (r.status === 'Completed') {
        row.sold_qty += qty
        row.lifetime_revenue += amt
        row.monthKeys.add(ymKey(d))
        if (inFy(d)) {
          row.fy_qty += qty
          row.fy_revenue += amt
        }
        if (ymKey(d) === thisYm) row.this_month_qty += qty
      }
      companyMap.set(key, row)
    }

    const companies = [...companyMap.values()]
      .map((row) => {
        const active = Math.max(1, row.monthKeys.size || 1)
        return {
          company: row.company,
          orders_count: row.orderIds.size,
          pending_qty: row.pending_qty,
          sold_qty: row.sold_qty,
          monthly_avg_qty: Math.round((row.sold_qty / active) * 10) / 10,
          monthly_avg_revenue: Math.round(row.lifetime_revenue / active),
          monthly_avg_revenue_label: formatRupee(Math.round(row.lifetime_revenue / active)),
          fy_qty: row.fy_qty,
          fy_revenue: row.fy_revenue,
          fy_revenue_label: formatRupee(row.fy_revenue),
          lifetime_revenue: row.lifetime_revenue,
          lifetime_revenue_label: formatRupee(row.lifetime_revenue),
          this_month_qty: row.this_month_qty,
        }
      })
      .sort((a, b) => b.lifetime_revenue - a.lifetime_revenue || a.company.localeCompare(b.company))

    const history = [
      ...stockAdds.rows.map((m) => ({
        kind: 'stock',
        company: m.label || 'Stock',
        order_no: '—',
        qty: Number(m.qty) || 0,
        amount_label: '—',
        date: m.date || '—',
        status: 'Add in stock',
        sortAt: m.created_at ? new Date(m.created_at).getTime() : 0,
      })),
      ...lines.map((r) => ({
        kind: 'order',
        company: r.company || '—',
        order_no: r.order_no || '—',
        qty: Number(r.qty) || 0,
        amount_label: formatRupee(parseAmt(r.amount)),
        date: r.date || '—',
        status: r.status || '—',
        sortAt: r.created_at ? new Date(r.created_at).getTime() : 0,
      })),
    ].sort((a, b) => b.sortAt - a.sortAt)

    res.json({
      product: {
        ...codeRes.rows[0],
        stock_qty: Math.max(0, Number(codeRes.rows[0].stock_qty) || 0),
        items,
      },
      stats: {
        available: Math.max(0, Number(codeRes.rows[0].stock_qty) || 0),
        pending_qty: pendingQty,
        sold_qty: soldQty,
        customers_count: customers.size,
        orders_count: new Set(lines.map((r) => r.order_id)).size,
        this_month_qty: thisMonthQty,
        this_month_revenue: formatRupee(thisMonthRevenue),
        monthly_avg_qty: monthlyAvgQty,
        monthly_avg_revenue: formatRupee(monthlyAvgRevenue),
        fy_label: `FY ${fy.label}`,
        fy_qty: fyQty,
        fy_revenue: formatRupee(fyRevenue),
        lifetime_qty: soldQty,
        lifetime_revenue: formatRupee(lifetimeRevenue),
        months_active: monthsActive,
      },
      companies,
      months,
      history,
    })
  } catch (error) {
    console.error('Error fetching product summary:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Stored monthly sold-qty history for one product (resets each calendar month). */
app.get('/api/product-codes/:id/monthly-stats', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const { id } = req.params
  try {
    const codeRes = await pool.query('SELECT id, code, name FROM product_codes WHERE id = $1', [id])
    if (codeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product code not found.' })
    }
    await syncProductMonthlyStats(Number(id))
    const months = await getStoredMonthlyStats('product', Number(id))
    const thisMonth = currentYearMonth()
    res.json({
      product: codeRes.rows[0],
      metric: 'sold',
      current_month: thisMonth,
      current_label: formatYearMonthLabel(thisMonth),
      monthly_avg: months.find((m) => m.is_current)?.qty ?? 0,
      months,
    })
  } catch (error) {
    console.error('Error fetching product monthly stats:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Add product stock (+ qty available) and deduct ALL linked inventory parts. */
app.post('/api/product-codes/:id/add-qty', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const qty = Number(req.body?.qty)
  const orderNo = String(req.body?.stock || req.body?.order_no || 'Stock').trim() || 'Stock'
  const date =
    String(req.body?.date || '').trim() ||
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const note = String(req.body?.note || '').trim() || 'Product stock added'

  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: 'Enter a product qty greater than 0.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const codeRes = await client.query('SELECT * FROM product_codes WHERE id = $1 FOR UPDATE', [id])
    if (codeRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'Product code not found.' })
    }

    const items = await getProductCodeItems(Number(id), client)
    if (items.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'Link inventory parts before adding product qty.' })
    }

    // + product stock
    const before = Math.max(0, Number(codeRes.rows[0].stock_qty) || 0)
    const newStock = before + qty
    const updated = await client.query(
      `UPDATE product_codes
       SET stock_qty = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [newStock, id]
    )

    await client.query(
      `INSERT INTO product_stock_movements
         (product_code_id, label, qty, stock_after, movement_date, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, orderNo, qty, newStock, date, note, req.user.id]
    )

    // − every linked inventory part (merge duplicate links)
    const bomByInventory = new Map()
    for (const item of items) {
      const invId = Number(item.inventory_id)
      const per = Number(item.qty_per_unit) || 1
      const prev = bomByInventory.get(invId)
      if (prev) {
        prev.qty_per_unit += per
      } else {
        bomByInventory.set(invId, {
          inventory_id: invId,
          name: item.name,
          qty_per_unit: per,
        })
      }
    }

    const deductions = []
    const target = await getLowStockTarget(client)
    for (const item of bomByInventory.values()) {
      const deduct = item.qty_per_unit * qty
      const inv = await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [item.inventory_id])
      if (inv.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: `Inventory part missing: ${item.name}` })
      }
      const invBefore = Number(inv.rows[0].available) || 0
      const newAvail = invBefore - deduct
      const booked = await getBookedQtyForInventory(item.inventory_id, client)
      const autoStatus = inventoryStatus(newAvail, booked, target)
      await client.query(
        `UPDATE inventory SET
          available = $1,
          pending = $2,
          status = $3,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newAvail, booked, autoStatus, item.inventory_id]
      )
      await client.query(
        `INSERT INTO inventory_movements (inventory_id, order_no, product_code, qty, movement_date, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.inventory_id, orderNo, codeRes.rows[0].code, -deduct, date, note, req.user.id]
      )
      deductions.push({
        inventory_id: item.inventory_id,
        name: item.name || inv.rows[0].name,
        qty_per_unit: item.qty_per_unit,
        deducted: deduct,
        available_before: invBefore,
        available: newAvail,
      })
    }

    await client.query('COMMIT')

    const refreshedItems = await getProductCodeItems(Number(id))
    const bookedRes = await pool.query(
      `SELECT COALESCE(SUM(oi.qty), 0)::int AS booked
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id = $1 AND o.status = 'Pending'`,
      [id]
    )
    const soldRes = await pool.query(
      `SELECT COALESCE(SUM(oi.qty), 0)::int AS sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id = $1 AND o.status = 'Completed'`,
      [id]
    )
    const avgRes = await pool.query(
      `SELECT COALESCE(SUM(oi.qty), 0)::float AS monthly_avg
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id = $1
         AND o.status = 'Completed'
         AND TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') =
             TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')`,
      [id]
    )

    const stockQty = Math.max(0, Number(updated.rows[0].stock_qty) || 0)
    const booked = Number(bookedRes.rows[0]?.booked) || 0
    res.json({
      ...updated.rows[0],
      stock_qty: stockQty,
      items: refreshedItems,
      qty_available: stockQty,
      booked,
      required_qty: booked,
      sold: Number(soldRes.rows[0]?.sold) || 0,
      monthly_avg: Number(avgRes.rows[0]?.monthly_avg) || 0,
      product_qty_added: qty,
      stock_before: before,
      deductions,
      date,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error adding product qty:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

app.get('/api/product-codes/:id/stock-check', requireRoles(['admin', 'inventory', 'sales']), async (req, res) => {
  const multiplier = Number(req.query.qty) || 1
  try {
    const codeRes = await pool.query('SELECT * FROM product_codes WHERE id = $1', [req.params.id])
    if (codeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product code not found.' })
    }
    const items = await getProductCodeItems(Number(req.params.id))
    const breakdown = items.map((item) => {
      const booked = item.qty_per_unit * multiplier
      const remaining = item.available - booked
      return {
        inventory_id: item.inventory_id,
        name: item.name,
        sku: item.sku,
        qty_per_unit: item.qty_per_unit,
        product_qty: multiplier,
        available: item.available,
        booked,
        remaining,
        total_qty: booked,
        in_stock: remaining >= 0,
        display: `${item.name} × ${booked}`,
      }
    })
    const warnings = await checkStockForProductCode(Number(req.params.id), multiplier)
    res.json({
      product_code: codeRes.rows[0],
      multiplier,
      breakdown,
      warnings,
      stockOk: warnings.length === 0,
    })
  } catch (error) {
    console.error('Stock check error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/product-codes', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { code, name, description, items } = req.body
  if (!code || !name) {
    return res.status(400).json({ message: 'Code and name are required.' })
  }
  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'At least one product item is required.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const codeRes = await client.query(
      'INSERT INTO product_codes (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [code.toUpperCase(), name, description || '', req.user.id]
    )
    const codeId = codeRes.rows[0].id
    for (const item of items) {
      const invId = Number(item.inventory_id)
      if (!invId) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: 'Each product item needs a valid inventory.' })
      }
      const invCheck = await client.query('SELECT id FROM inventory WHERE id = $1', [invId])
      if (invCheck.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: `Inventory id ${invId} not found.` })
      }
      await client.query(
        'INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)',
        [codeId, invId, Number(item.qty_per_unit) || 1]
      )
    }
    await client.query('COMMIT')
    const result = { ...codeRes.rows[0], items: await getProductCodeItems(codeId) }
    res.status(201).json(result)
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Product code already exists.' })
    }
    console.error('Error creating product code:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

app.put('/api/product-codes/:id', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const { code, name, description, items } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const codeRes = await client.query(
      `UPDATE product_codes SET
        code = COALESCE($1, code),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [code ? code.toUpperCase() : null, name, description, id]
    )
    if (codeRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'Product code not found.' })
    }
    if (items) {
      if (items.length === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: 'At least one inventory item is required.' })
      }
      await client.query('DELETE FROM product_code_items WHERE product_code_id = $1', [id])
      for (const item of items) {
        const invId = Number(item.inventory_id)
        const invCheck = await client.query('SELECT id FROM inventory WHERE id = $1', [invId])
        if (invCheck.rows.length === 0) {
          await client.query('ROLLBACK')
          return res.status(400).json({ message: `Inventory id ${invId} not found.` })
        }
        await client.query(
          'INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)',
          [id, invId, Number(item.qty_per_unit) || 1]
        )
      }
    }
    await client.query('COMMIT')
    res.json({ ...codeRes.rows[0], items: await getProductCodeItems(Number(id)) })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error updating product code:', error)
    res.status(500).json({ message: 'Server error' })
  } finally {
    client.release()
  }
})

async function syncAllProductMonthlyStats(client = pool) {
  const codes = await client.query('SELECT id FROM product_codes')
  for (const row of codes.rows) {
    await syncProductMonthlyStats(Number(row.id), client)
  }
}

async function syncAllInventoryMonthlyStats(client = pool) {
  const items = await client.query('SELECT id FROM inventory')
  for (const row of items.rows) {
    await syncInventoryMonthlyStats(Number(row.id), client)
  }
}

app.delete('/api/product-codes/:id', requireRoles(['admin']), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM product_codes WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product code not found.' })
    }
    res.json({ message: 'Product code deleted.' })
  } catch (error) {
    console.error('Error deleting product code:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── Reports ─────────────────────────────────────────────────────────────────
app.get('/api/reports/summary', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const thisMonth = currentYearMonth()
    const [
      ordersTotal,
      ordersPending,
      ordersCompleted,
      ordersCancelled,
      soldMonth,
      revenueMonth,
      revenueAll,
      productsCount,
      inventoryCount,
      lowStock,
      customersCount,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(qty), 0)::int AS qty FROM orders WHERE status <> 'Cancelled'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'Pending'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'Completed'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'Cancelled'`),
      pool.query(
        `SELECT COALESCE(SUM(oi.qty), 0)::int AS qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'Completed'
           AND TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') = $1`,
        [thisMonth]
      ),
      pool.query(
        `SELECT COALESCE(SUM(
           NULLIF(regexp_replace(COALESCE(amount, '0'), '[^0-9.]', '', 'g'), '')::numeric
         ), 0) AS amount
         FROM orders
         WHERE status = 'Completed'
           AND TO_CHAR(COALESCE(closed_at, created_at), 'YYYY-MM') = $1`,
        [thisMonth]
      ),
      pool.query(
        `SELECT COALESCE(SUM(
           NULLIF(regexp_replace(COALESCE(amount, '0'), '[^0-9.]', '', 'g'), '')::numeric
         ), 0) AS amount
         FROM orders
         WHERE status = 'Completed'`
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM product_codes`),
      pool.query(`SELECT COUNT(*)::int AS n FROM inventory`),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM inventory WHERE status IN ('Low Stock', 'Defect', 'Critical')`
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM customers`),
    ])

    res.json({
      current_month: thisMonth,
      current_label: formatYearMonthLabel(thisMonth),
      orders: {
        total: ordersTotal.rows[0].n,
        qty: ordersTotal.rows[0].qty,
        pending: ordersPending.rows[0].n,
        completed: ordersCompleted.rows[0].n,
        cancelled: ordersCancelled.rows[0].n,
      },
      sold_this_month: soldMonth.rows[0].qty,
      revenue_this_month: Number(revenueMonth.rows[0].amount) || 0,
      revenue_all_time: Number(revenueAll.rows[0].amount) || 0,
      products: productsCount.rows[0].n,
      inventory: inventoryCount.rows[0].n,
      low_stock: lowStock.rows[0].n,
      customers: customersCount.rows[0].n,
    })
  } catch (error) {
    console.error('Error fetching report summary:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/reports/history', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const scope = String(req.query.scope || 'orders')
    const month = String(req.query.month || '').trim() // YYYY-MM or empty = all
    const limit = Math.min(500, Math.max(50, Number(req.query.limit) || 200))

    if (scope === 'orders') {
      const params = []
      let where = `WHERE o.status <> 'Cancelled'`
      if (month) {
        params.push(month)
        where += ` AND TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') = $${params.length}`
      }
      params.push(limit)
      const result = await pool.query(
        `SELECT
           o.order_no,
           o.company,
           COALESCE(oi.product_code, o.product_code, '—') AS product_code,
           COALESCE(oi.product_name, o.product_name, '—') AS product_name,
           COALESCE(oi.qty, o.qty, 0)::int AS qty,
           o.amount,
           o.status,
           COALESCE(o.date, TO_CHAR(o.created_at, 'DD Mon YYYY')) AS date,
           TO_CHAR(COALESCE(o.closed_at, o.created_at), 'YYYY-MM') AS year_month,
           o.created_at
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         ${where}
         ORDER BY o.created_at DESC
         LIMIT $${params.length}`,
        params
      )
      return res.json({
        scope: 'orders',
        month: month || null,
        rows: result.rows.map((r) => ({
          ...r,
          month_label: formatYearMonthLabel(r.year_month),
          qty: Number(r.qty) || 0,
        })),
      })
    }

    if (scope === 'products') {
      const params = []
      let where = ''
      if (month) {
        params.push(month)
        where = `WHERE TO_CHAR(m.created_at, 'YYYY-MM') = $1`
      }
      params.push(limit)
      const result = await pool.query(
        `SELECT
           pc.code AS product_code,
           pc.name AS product_name,
           m.label,
           m.qty::int AS qty,
           m.stock_after::int AS stock_after,
           m.movement_date AS date,
           TO_CHAR(m.created_at, 'YYYY-MM') AS year_month,
           m.created_at
         FROM product_stock_movements m
         JOIN product_codes pc ON pc.id = m.product_code_id
         ${where}
         ORDER BY m.created_at DESC
         LIMIT $${params.length}`,
        params
      )
      return res.json({
        scope: 'products',
        month: month || null,
        rows: result.rows.map((r) => ({
          ...r,
          month_label: formatYearMonthLabel(r.year_month),
          qty: Number(r.qty) || 0,
          stock_after: Number(r.stock_after) || 0,
        })),
      })
    }

    // inventory movements + sales usage history
    const params = []
    let where = ''
    if (month) {
      params.push(month)
      where = `WHERE TO_CHAR(m.created_at, 'YYYY-MM') = $1`
    }
    params.push(limit)
    const moves = await pool.query(
      `SELECT
         i.name AS inventory_name,
         COALESCE(m.order_no, '—') AS ref,
         COALESCE(m.product_code, '—') AS product_code,
         m.qty::int AS qty,
         m.movement_date AS date,
         CASE WHEN m.qty > 0 THEN 'Inward' WHEN m.qty < 0 THEN 'Used / Stock' ELSE 'Move' END AS type,
         TO_CHAR(m.created_at, 'YYYY-MM') AS year_month,
         m.created_at
       FROM inventory_movements m
       JOIN inventory i ON i.id = m.inventory_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length}`,
      params
    )
    res.json({
      scope: 'inventory',
      month: month || null,
      rows: moves.rows.map((r) => ({
        ...r,
        month_label: formatYearMonthLabel(r.year_month),
        qty: Number(r.qty) || 0,
      })),
    })
  } catch (error) {
    console.error('Error fetching report history:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/reports/monthly-avg', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const scope = String(req.query.scope || 'both') // products | inventory | both
    const month = String(req.query.month || '').trim() // YYYY-MM or empty = all months

    if (scope === 'products' || scope === 'both') {
      await syncAllProductMonthlyStats()
    }
    if (scope === 'inventory' || scope === 'both') {
      await syncAllInventoryMonthlyStats()
    }

    const thisMonth = currentYearMonth()
    const rows = []

    if (scope === 'products' || scope === 'both') {
      const params = ['product']
      let monthFilter = ''
      if (month) {
        params.push(month)
        monthFilter = ` AND s.year_month = $${params.length}`
      }
      const result = await pool.query(
        `SELECT
           s.year_month,
           s.qty::float AS qty,
           pc.id AS ref_id,
           pc.code,
           pc.name
         FROM monthly_qty_stats s
         JOIN product_codes pc ON pc.id = s.ref_id
         WHERE s.kind = $1
           ${monthFilter}
         ORDER BY s.year_month DESC, pc.code ASC`,
        params
      )
      for (const r of result.rows) {
        rows.push({
          kind: 'product',
          ref_id: r.ref_id,
          code: r.code,
          name: r.name,
          year_month: r.year_month,
          month_label: formatYearMonthLabel(r.year_month),
          qty: Number(r.qty) || 0,
          metric: 'Sold',
          is_current: r.year_month === thisMonth,
        })
      }
    }

    if (scope === 'inventory' || scope === 'both') {
      const params = ['inventory']
      let monthFilter = ''
      if (month) {
        params.push(month)
        monthFilter = ` AND s.year_month = $${params.length}`
      }
      const result = await pool.query(
        `SELECT
           s.year_month,
           s.qty::float AS qty,
           i.id AS ref_id,
           i.name,
           i.sku
         FROM monthly_qty_stats s
         JOIN inventory i ON i.id = s.ref_id
         WHERE s.kind = $1
           ${monthFilter}
         ORDER BY s.year_month DESC, i.name ASC`,
        params
      )
      for (const r of result.rows) {
        rows.push({
          kind: 'inventory',
          ref_id: r.ref_id,
          code: r.sku || '—',
          name: r.name,
          year_month: r.year_month,
          month_label: formatYearMonthLabel(r.year_month),
          qty: Number(r.qty) || 0,
          metric: 'Used',
          is_current: r.year_month === thisMonth,
        })
      }
    }

    // available months list for UI dropdown
    const monthsRes = await pool.query(
      `SELECT DISTINCT year_month FROM monthly_qty_stats ORDER BY year_month DESC`
    )

    res.json({
      scope,
      month: month || null,
      current_month: thisMonth,
      current_label: formatYearMonthLabel(thisMonth),
      months: monthsRes.rows.map((r) => ({
        year_month: r.year_month,
        label: formatYearMonthLabel(r.year_month),
        is_current: r.year_month === thisMonth,
      })),
      rows,
    })
  } catch (error) {
    console.error('Error fetching monthly avg report:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Every product: customers, sold qty + revenue (monthly avg, FY, lifetime) */
app.get('/api/reports/products-detail', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const now = new Date()
    const fy = getFinancialYear(now)
    const fyStart = new Date(fy.startYear, 3, 1)
    const fyEnd = new Date(fy.endYear, 2, 31, 23, 59, 59)
    const thisYm = currentYearMonth()

    const codes = await pool.query(
      `SELECT id, code, name, COALESCE(stock_qty, 0)::int AS stock_qty
       FROM product_codes
       ORDER BY code ASC`
    )
    const linesRes = await pool.query(
      `SELECT
         oi.product_code_id,
         o.company,
         o.status,
         oi.qty::int AS qty,
         oi.amount,
         COALESCE(o.closed_at, o.created_at) AS event_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_code_id IS NOT NULL
         AND o.status <> 'Cancelled'`
    )

    const byProduct = new Map()
    for (const code of codes.rows) {
      byProduct.set(Number(code.id), {
        product_code_id: Number(code.id),
        code: code.code,
        name: code.name,
        available: Math.max(0, Number(code.stock_qty) || 0),
        customers: new Set(),
        pending_qty: 0,
        sold_qty: 0,
        lifetime_revenue: 0,
        fy_qty: 0,
        fy_revenue: 0,
        this_month_qty: 0,
        this_month_revenue: 0,
        monthKeys: new Set(),
      })
    }

    for (const row of linesRes.rows) {
      const pid = Number(row.product_code_id)
      const bucket = byProduct.get(pid)
      if (!bucket) continue
      const company = String(row.company || '').trim()
      if (company) bucket.customers.add(company.toLowerCase())
      const qty = Number(row.qty) || 0
      const amt = parseAmount(row.amount)
      const d = new Date(row.event_at)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (row.status === 'Pending') bucket.pending_qty += qty
      if (row.status === 'Completed') {
        bucket.sold_qty += qty
        bucket.lifetime_revenue += amt
        if (!Number.isNaN(d.getTime())) {
          bucket.monthKeys.add(ym)
          if (d >= fyStart && d <= fyEnd) {
            bucket.fy_qty += qty
            bucket.fy_revenue += amt
          }
          if (ym === thisYm) {
            bucket.this_month_qty += qty
            bucket.this_month_revenue += amt
          }
        }
      }
    }

    const rows = [...byProduct.values()].map((b) => {
      const monthsActive = Math.max(1, b.monthKeys.size || 1)
      return {
        product_code_id: b.product_code_id,
        code: b.code,
        name: b.name,
        available: b.available,
        customers_count: b.customers.size,
        pending_qty: b.pending_qty,
        sold_qty: b.sold_qty,
        monthly_avg_qty: Math.round((b.sold_qty / monthsActive) * 10) / 10,
        fy_qty: b.fy_qty,
        lifetime_qty: b.sold_qty,
        this_month_qty: b.this_month_qty,
        monthly_avg_revenue: Math.round(b.lifetime_revenue / monthsActive),
        monthly_avg_revenue_label: formatRupee(Math.round(b.lifetime_revenue / monthsActive)),
        fy_revenue: b.fy_revenue,
        fy_revenue_label: formatRupee(b.fy_revenue),
        lifetime_revenue: b.lifetime_revenue,
        lifetime_revenue_label: formatRupee(b.lifetime_revenue),
        this_month_revenue: b.this_month_revenue,
        this_month_revenue_label: formatRupee(b.this_month_revenue),
        fy_label: `FY ${fy.label}`,
        months_active: monthsActive,
      }
    })

    res.json({
      fy_label: `FY ${fy.label}`,
      current_month: thisYm,
      rows,
    })
  } catch (error) {
    console.error('Error fetching products detail report:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

/** Every inventory part: customers, used qty — monthly avg / FY / lifetime */
app.get('/api/reports/inventory-detail', requireRoles(['admin', 'sales', 'inventory']), async (req, res) => {
  try {
    const now = new Date()
    const fy = getFinancialYear(now)
    const fyStart = new Date(fy.startYear, 3, 1)
    const fyEnd = new Date(fy.endYear, 2, 31, 23, 59, 59)
    const thisYm = currentYearMonth()

    const items = await pool.query(
      `SELECT id, name, sku, available, status FROM inventory ORDER BY name ASC`
    )
    const usageRes = await pool.query(
      `SELECT
         pci.inventory_id,
         o.company,
         o.status,
         (pci.qty_per_unit * oi.qty)::int AS qty,
         COALESCE(o.closed_at, o.created_at) AS event_at
       FROM product_code_items pci
       JOIN order_items oi ON oi.product_code_id = pci.product_code_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status <> 'Cancelled'`
    )

    const byInv = new Map()
    for (const item of items.rows) {
      byInv.set(Number(item.id), {
        inventory_id: Number(item.id),
        name: item.name,
        sku: item.sku || '',
        available: Number(item.available) || 0,
        status: item.status,
        customers: new Set(),
        pending_qty: 0,
        used_qty: 0,
        fy_qty: 0,
        this_month_qty: 0,
        monthKeys: new Set(),
      })
    }

    for (const row of usageRes.rows) {
      const id = Number(row.inventory_id)
      const bucket = byInv.get(id)
      if (!bucket) continue
      const company = String(row.company || '').trim()
      if (company) bucket.customers.add(company.toLowerCase())
      const qty = Number(row.qty) || 0
      const d = new Date(row.event_at)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (row.status === 'Pending') bucket.pending_qty += qty
      if (row.status === 'Completed') {
        bucket.used_qty += qty
        if (!Number.isNaN(d.getTime())) {
          bucket.monthKeys.add(ym)
          if (d >= fyStart && d <= fyEnd) bucket.fy_qty += qty
          if (ym === thisYm) bucket.this_month_qty += qty
        }
      }
    }

    const rows = [...byInv.values()].map((b) => {
      const monthsActive = Math.max(1, b.monthKeys.size || 1)
      return {
        inventory_id: b.inventory_id,
        name: b.name,
        sku: b.sku,
        available: b.available,
        status: b.status,
        customers_count: b.customers.size,
        pending_qty: b.pending_qty,
        used_qty: b.used_qty,
        monthly_avg_qty: Math.round((b.used_qty / monthsActive) * 10) / 10,
        fy_qty: b.fy_qty,
        lifetime_qty: b.used_qty,
        this_month_qty: b.this_month_qty,
        fy_label: `FY ${fy.label}`,
        months_active: monthsActive,
      }
    })

    res.json({
      fy_label: `FY ${fy.label}`,
      current_month: thisYm,
      rows,
    })
  } catch (error) {
    console.error('Error fetching inventory detail report:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

if (isProduction) {
  const publicDir = path.join(__dirname, 'public')
  app.use(express.static(publicDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  try {
    const info = await pool.query('SELECT current_database() AS db, inet_server_port() AS port')
    console.log(`Connected to PostgreSQL: ${info.rows[0].db} on port ${info.rows[0].port}`)
  } catch {
    console.log('Connected to PostgreSQL database')
  }
})
