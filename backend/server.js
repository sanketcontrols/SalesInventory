import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from './db.js'
import { initializeDatabase } from './init.js'
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
app.use(express.json())

await initializeDatabase().catch((error) => {
  console.error('Failed to initialize database:', error.message)
  console.error('Make sure PostgreSQL is running and DATABASE_URL is correct.')
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
  return result.rows.map((row) => ({
    ...row,
    available: Number(row.available) || 0,
    booked: Number(row.booked) || 0,
    pending: Number(row.booked) || 0,
  }))
}

function inventoryStatus(available, requiredQty = 0) {
  if (available < 0) return 'Defect'
  if (available <= 0) return 'Defect'
  if (requiredQty > 0 && available < requiredQty) return 'Low Stock'
  if (available <= 20) return 'Low Stock'
  return 'Normal'
}

function mapInventoryRow(row) {
  if (!row) return row
  const available = Number(row.available) || 0
  // Booked = qty reserved by Pending sales orders (live from sales_required)
  const booked = Number(row.sales_required ?? row.pending) || 0
  return {
    ...row,
    qty: available,
    available,
    required_qty: booked,
    sales_required: booked,
    monthly_avg: Number(row.monthly_avg) || 0,
    booked,
    pending: booked,
    remaining: available,
    status: row.status || inventoryStatus(available, booked),
  }
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

async function checkStockForProductCode(productCodeId, multiplier, client = pool) {
  const items = await getProductCodeItems(productCodeId, client)
  const warnings = []
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
      })
    }
  }
  return warnings
}

async function adjustStockForProductCode(productCodeId, multiplier, direction, client = pool) {
  // direction: 1 = book/reserve, -1 = release/restore
  // available can go negative when stock is short (MFG shows red)
  const items = await getProductCodeItems(productCodeId, client)
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
    const status = inventoryStatus(newAvailable, newPending)

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
    const result = await pool.query('SELECT id, name, email, role, password FROM users WHERE LOWER(email) = LOWER($1)', [email])

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    const user = result.rows[0]

    // Always use latest role from DB (admin may have changed it).
    const fresh = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [user.id])
    const profile = fresh.rows[0] || user

    const valid = await verifyPassword(password, user.password)

    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    if (!isHashed(user.password)) {
      const hashedPassword = await hashPassword(password)
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id])
    }

    const token = signToken(profile)
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
    return res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' })
  }
})

// Protected routes
app.use('/api', authMiddleware)

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
        "SELECT name, sku, available, status FROM inventory WHERE status IN ('Low Stock', 'Defect', 'Critical') ORDER BY available ASC LIMIT 10"
      )
      const outOfStock = lowStock.rows.filter((r) => r.available === 0)

      if (outOfStock.length > 0) {
        items.push({
          title: `${outOfStock.length} Out of Stock`,
          description: outOfStock.map((r) => r.name).join(', '),
          tone: 'red',
        })
      }

      const lowOnly = lowStock.rows.filter((r) => r.available > 0)
      if (lowOnly.length > 0) {
        items.push({
          title: `${lowOnly.length} Low Stock Alert${lowOnly.length > 1 ? 's' : ''}`,
          description: 'Review inventory and reorder items below threshold.',
          tone: 'amber',
        })
      }

      if (items.length === 0) {
        items.push({
          title: 'Stock Levels Normal',
          description: 'All inventory items are within normal levels.',
          tone: 'green',
        })
      }
    }

    if (showOrders) {
      const pendingOrders = await pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE status = 'Pending'")
      if (pendingOrders.rows[0].count > 0) {
        items.push({
          title: `${pendingOrders.rows[0].count} Pending Order${pendingOrders.rows[0].count > 1 ? 's' : ''}`,
          description: 'Orders awaiting completion or dispatch.',
          tone: 'blue',
        })
      }
    }

    res.json(items)
  } catch (error) {
    console.error('Notifications error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.get('/api/company/settings', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT company_name, address, gst_no, updated_at FROM company_settings ORDER BY id LIMIT 1')
    if (result.rows.length === 0) {
      return res.json({ company_name: 'Purn Sanket Electrols', address: '', gst_no: '' })
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Company settings fetch error:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/company/settings', requireRoles(['admin']), async (req, res) => {
  const { company_name, address, gst_no } = req.body
  if (!company_name) {
    return res.status(400).json({ message: 'Company name is required.' })
  }
  try {
    const existing = await pool.query('SELECT id FROM company_settings ORDER BY id LIMIT 1')
    let result
    if (existing.rows.length === 0) {
      result = await pool.query(
        'INSERT INTO company_settings (company_name, address, gst_no) VALUES ($1, $2, $3) RETURNING company_name, address, gst_no, updated_at',
        [company_name, address || '', gst_no || '']
      )
    } else {
      result = await pool.query(
        'UPDATE company_settings SET company_name = $1, address = $2, gst_no = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING company_name, address, gst_no, updated_at',
        [company_name, address || '', gst_no || '', existing.rows[0].id]
      )
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Company settings update error:', error)
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
      return res.json({ breakdown: [], warnings: [], stockOk: true })
    }

    const breakdown = []
    const warnings = []

    for (const line of items) {
      const codeId = Number(line.product_code_id)
      const qty = Number(line.qty) || 0
      if (!codeId || qty <= 0) continue

      const codeRes = await pool.query('SELECT code, name FROM product_codes WHERE id = $1', [codeId])
      const label = codeRes.rows[0] ? `${codeRes.rows[0].code}` : `Product #${codeId}`
      const lineWarnings = await checkStockForProductCode(codeId, qty)
      const codeItems = await getProductCodeItems(codeId)

      for (const item of codeItems) {
        const booked = item.qty_per_unit * qty
        const remaining = item.available - booked
        breakdown.push({
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

    res.json({ breakdown, warnings, stockOk: warnings.length === 0 })
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
    res.json(await enrichOrder(result.rows[0], items, client))
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
    let query = 'SELECT * FROM orders WHERE company ILIKE $1'
    const params = [companyName]

    if (month && year) {
      params.push(Number(year), Number(month))
      query += ` AND EXTRACT(YEAR FROM created_at) = $2 AND EXTRACT(MONTH FROM created_at) = $3`
    } else if (year) {
      params.push(Number(year))
      query += ` AND EXTRACT(YEAR FROM created_at) = $2`
    }

    query += ` ORDER BY
      CASE WHEN order_no ~ '^FY[0-9]{2}-[0-9]{2}_' THEN 0 ELSE 1 END,
      order_no DESC,
      created_at DESC`
    const ordersResult = await pool.query(query, params)
    const orders = await Promise.all(
      ordersResult.rows.map(async (order) => {
        const items = await getOrderItems(order.id)
        return enrichOrder(order, items)
      })
    )

    const [total, pending, completed, thisMonth, amounts] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1', [companyName]),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND status = 'Pending'", [companyName]),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND status = 'Completed'", [companyName]),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [companyName]
      ),
      pool.query(`SELECT amount FROM orders WHERE company ILIKE $1 AND status != 'Cancelled'`, [companyName]),
    ])

    const totalRevenue = amounts.rows.reduce((sum, row) => sum + parseAmount(row.amount), 0)
    const filteredRevenue = orders
      .filter((o) => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + parseAmount(o.amount), 0)

    res.json({
      customer: customerRes.rows[0],
      orders,
      stats: {
        totalOrders: total.rows[0].count,
        pendingOrders: pending.rows[0].count,
        completedOrders: completed.rows[0].count,
        ordersThisMonth: thisMonth.rows[0].count,
        totalRevenue: formatRupee(totalRevenue),
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

  if (!name || !email || !phone || !city || !state) {
    return res.status(400).json({ message: 'Name, email, phone, city, and state are required.' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, email, phone, city, state, orders_count, total_amount, gst_no, address, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, email, phone, city, state, 0, '₹ 0', gst_no || '', address || '', req.user.id]
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
          SELECT ROUND(SUM(pci.qty_per_unit * oi.qty)::numeric / 3.0, 1)
          FROM product_code_items pci
          JOIN order_items oi ON oi.product_code_id = pci.product_code_id
          JOIN orders o ON o.id = oi.order_id
          WHERE pci.inventory_id = i.id
            AND o.status <> 'Cancelled'
            AND o.created_at >= NOW() - INTERVAL '90 days'
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
    res.json(result.rows.map(mapInventoryRow))
  } catch (error) {
    console.error('Error fetching inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/inventory', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { name, available, pending, reserved, status } = req.body

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Inventory name is required.' })
  }

  try {
    const avail = Number(available) || 0
    const pend = Number(pending) || 0
    const resv = Number(reserved) || 0
    const itemStatus = status || inventoryStatus(avail, 0)
    const base = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    const sku = `${base || 'ITEM'}-${Date.now().toString().slice(-4)}`

    const result = await pool.query(
      `INSERT INTO inventory (name, sku, available, pending, reserved, required_qty, status, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, CURRENT_TIMESTAMP) RETURNING *`,
      [name.trim(), sku, avail, pend, resv, itemStatus, req.user.id]
    )

    res.status(201).json(mapInventoryRow({ ...result.rows[0], sales_required: 0, monthly_avg: 0 }))
  } catch (error) {
    console.error('Error creating inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/inventory/:id', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const { available, reserved, status, name } = req.body

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
    const autoStatus = status || inventoryStatus(avail, booked)

    const result = await pool.query(
      `UPDATE inventory SET
        name = COALESCE($1, name),
        available = COALESCE($2, available),
        pending = $3,
        reserved = COALESCE($4, reserved),
        status = $5,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [
        name != null ? String(name).trim() : null,
        available != null ? Number(available) : null,
        booked,
        reserved != null ? Number(reserved) : null,
        autoStatus,
        id,
      ]
    )

    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }))
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
    const autoStatus = inventoryStatus(avail, booked)

    const result = await pool.query(
      `UPDATE inventory SET
        available = $1,
        pending = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [avail, booked, autoStatus, id]
    )

    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }))
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

/** Add qty with optional order no + product code; date defaults to today */
app.post('/api/inventory/:id/add-qty', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const qty = Number(req.body?.qty)
  const orderNo = String(req.body?.order_no || '').trim()
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
    const autoStatus = inventoryStatus(avail, booked)

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
    res.json(mapInventoryRow({ ...result.rows[0], sales_required: booked }))
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

      const existing = await pool.query('SELECT id FROM inventory WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])
      if (existing.rows[0]) {
        skipped++
        continue
      }

      // Only Particulars: do not import Quantity / Rate / Value unless explicitly provided and not namesOnly
      const avail = namesOnly ? 0 : Number(row.available ?? row.qty ?? row.Quantity) || 0
      const sku = String(row.sku || row.SKU || '').trim() || makeSku(name, i + 1)
      const required = namesOnly ? 0 : Number(row.required_qty) || 0
      const status = avail <= 0 ? 'Defect' : avail <= 20 ? 'Low Stock' : 'Normal'

      await pool.query(
        'INSERT INTO inventory (name, sku, available, pending, reserved, required_qty, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [name, sku, avail, 0, 0, required, status, req.user.id]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, skipped, total: rows.length, errors })
})

app.post('/api/customers/import', requireRoles(['admin', 'sales']), async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  const errors = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = row.name
      const email = row.email
      const phone = row.phone
      const city = row.city
      const state = row.state
      if (!name || !email || !phone || !city || !state) {
        errors.push(`Row ${i + 1}: name, email, phone, city, state required`)
        continue
      }
      await pool.query(
        `INSERT INTO customers (name, email, phone, city, state, orders_count, total_amount, gst_no, address, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [name, email, phone, city, state, Number(row.orders) || 0, row.total_amount || '₹ 0', row.gst_no || '', row.address || '', req.user.id]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, total: rows.length, errors })
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
    const withItems = await Promise.all(
      codes.rows.map(async (code) => {
        const items = await getProductCodeItems(code.id)
        const bookedRes = await pool.query(
          `SELECT COALESCE(SUM(oi.qty), 0)::int AS booked
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.product_code_id = $1 AND o.status = 'Pending'`,
          [code.id]
        )
        const qtyAvailable =
          items.length === 0
            ? null
            : Math.min(
                ...items.map((item) => {
                  const per = Number(item.qty_per_unit) || 1
                  return Math.floor((Number(item.available) || 0) / per)
                })
              )
        return {
          ...code,
          items,
          qty_available: qtyAvailable,
          booked: Number(bookedRes.rows[0]?.booked) || 0,
        }
      })
    )
    res.json(withItems)
  } catch (error) {
    console.error('Error fetching product codes:', error)
    res.status(500).json({ message: 'Server error' })
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
