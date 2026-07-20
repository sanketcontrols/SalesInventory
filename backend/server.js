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

async function getProductCodeItems(productCodeId) {
  const result = await pool.query(
    `SELECT pci.id, pci.qty_per_unit, i.id AS inventory_id, i.name, i.sku, i.available, i.status
     FROM product_code_items pci
     JOIN inventory i ON i.id = pci.inventory_id
     WHERE pci.product_code_id = $1
     ORDER BY i.name`,
    [productCodeId]
  )
  return result.rows
}

async function checkStockForProductCode(productCodeId, multiplier) {
  const items = await getProductCodeItems(productCodeId)
  const warnings = []
  for (const item of items) {
    const needed = item.qty_per_unit * multiplier
    if (item.available < needed) {
      warnings.push({
        name: item.name,
        sku: item.sku,
        needed,
        available: item.available,
        message: `${item.name} × ${needed} needed, only ${item.available} available`,
      })
    }
  }
  return warnings
}

async function reserveStockForProductCode(productCodeId, multiplier) {
  const items = await getProductCodeItems(productCodeId)
  for (const item of items) {
    const needed = item.qty_per_unit * multiplier
    const newAvailable = item.available - needed
    const newPending = (await pool.query('SELECT pending FROM inventory WHERE id = $1', [item.inventory_id])).rows[0].pending + needed
    const newStatus = newAvailable <= 0 ? 'Critical' : newAvailable <= 20 ? 'Low Stock' : 'Normal'
    await pool.query(
      'UPDATE inventory SET available = $1, pending = $2, status = $3 WHERE id = $4',
      [Math.max(0, newAvailable), newPending, newStatus, item.inventory_id]
    )
  }
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
    const result = await pool.query('SELECT id, name, email, role, password FROM users WHERE email = $1', [email])

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
      user: { id: profile.id, name: profile.name, email: profile.email, role: profile.role },
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
    res.json(result.rows[0])
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

    const lowStock = await pool.query("SELECT COUNT(*)::int AS count FROM inventory WHERE status IN ('Low Stock', 'Critical')")
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

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const items = []
    const role = req.user.role
    const showStock = role === 'admin' || role === 'inventory'
    const showOrders = role === 'admin' || role === 'sales'

    if (showStock) {
      const lowStock = await pool.query(
        "SELECT name, sku, available, status FROM inventory WHERE status IN ('Low Stock', 'Critical') ORDER BY available ASC LIMIT 10"
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
      return res.json({ company_name: 'HD Engineering Solutions', address: '', gst_no: '' })
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

    query += ' ORDER BY created_at DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching orders:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/orders', requireRoles(['admin', 'sales']), async (req, res) => {
  const { company, state, qty, amount, status, product_code_id, force } = req.body

  if (!company || !state || !qty) {
    return res.status(400).json({ message: 'Company, state, and quantity are required.' })
  }

  const multiplier = Number(qty)
  if (multiplier <= 0) {
    return res.status(400).json({ message: 'Quantity must be greater than 0.' })
  }

  try {
    let productCode = null
    let productName = null
    let orderAmount = amount

    if (product_code_id) {
      const codeRes = await pool.query('SELECT id, code, name FROM product_codes WHERE id = $1', [product_code_id])
      if (codeRes.rows.length === 0) {
        return res.status(404).json({ message: 'Product code not found.' })
      }
      productCode = codeRes.rows[0].code
      productName = codeRes.rows[0].name

      const warnings = await checkStockForProductCode(Number(product_code_id), multiplier)
      if (warnings.length > 0 && !force) {
        return res.status(409).json({
          message: 'Insufficient stock for this order.',
          warnings,
          stockOk: false,
        })
      }

      if (!orderAmount) {
        const items = await getProductCodeItems(Number(product_code_id))
        let total = 0
        for (const item of items) {
          const priceRes = await pool.query('SELECT price FROM products WHERE sku = $1 LIMIT 1', [item.sku])
          if (priceRes.rows[0]) {
            total += parseAmount(priceRes.rows[0].price) * item.qty_per_unit * multiplier
          }
        }
        orderAmount = formatRupee(total || 0)
      }

      await reserveStockForProductCode(Number(product_code_id), multiplier)
    }

    if (!orderAmount) {
      return res.status(400).json({ message: 'Amount is required when no product code is selected.' })
    }

    const orderNo = `#SO-${Date.now()}`
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

    const result = await pool.query(
      `INSERT INTO orders (order_no, company, state, date, qty, amount, status, created_by, product_code_id, product_code, product_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [orderNo, company, state, date, multiplier, orderAmount, status || 'Pending', req.user.id, product_code_id || null, productCode, productName]
    )

    // Update buyer company order count / total
    const customerRes = await pool.query('SELECT id, total_amount FROM customers WHERE name ILIKE $1 LIMIT 1', [company])
    if (customerRes.rows[0]) {
      const prev = parseAmount(customerRes.rows[0].total_amount)
      const next = formatRupee(prev + parseAmount(orderAmount))
      await pool.query(
        'UPDATE customers SET orders_count = orders_count + 1, total_amount = $1 WHERE id = $2',
        [next, customerRes.rows[0].id]
      )
    }

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating order:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/orders/:id', requireRoles(['admin', 'sales']), async (req, res) => {
  const { id } = req.params
  const { company, state, qty, amount, status } = req.body

  try {
    const existing = await pool.query('SELECT created_by, created_at FROM orders WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!enforceEditWindowOrOwnership(req, existing.rows[0])) {
      return res.status(403).json({ message: 'Edit not allowed (ownership or 48-hour window expired).' })
    }

    const result = await pool.query(
      'UPDATE orders SET company = COALESCE($1, company), state = COALESCE($2, state), qty = COALESCE($3, qty), amount = COALESCE($4, amount), status = COALESCE($5, status) WHERE id = $6 RETURNING *',
      [company, state, qty ? Number(qty) : null, amount, status, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating order:', error)
    res.status(500).json({ message: 'Server error' })
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
    const customer = await pool.query('SELECT name FROM customers WHERE id = $1', [req.params.id])
    if (customer.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    const companyName = customer.rows[0].name
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

    query += ' ORDER BY created_at DESC'
    const orders = await pool.query(query, params)

    const [total, pending, completed, thisMonth] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1', [companyName]),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND status = 'Pending'", [companyName]),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND status = 'Completed'", [companyName]),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM orders WHERE company ILIKE $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [companyName]
      ),
    ])

    res.json({
      customer: customer.rows[0],
      orders: orders.rows,
      stats: {
        totalOrders: total.rows[0].count,
        pendingOrders: pending.rows[0].count,
        completedOrders: completed.rows[0].count,
        ordersThisMonth: thisMonth.rows[0].count,
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
        'UPDATE customers SET name = $1 WHERE id = $2 RETURNING *',
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
         address = COALESCE($7, address)
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
app.get('/api/products', requireRoles(['admin']), async (req, res) => {
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
app.get('/api/inventory', requireRoles(['admin', 'inventory']), async (req, res) => {
  try {
    const { status } = req.query
    let query = 'SELECT * FROM inventory WHERE 1=1'
    const params = []

    if (status) {
      params.push(status)
      query += ` AND status = $${params.length}`
    }

    query += ' ORDER BY created_at DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.post('/api/inventory', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { name, sku, available, pending, reserved, status } = req.body

  if (!name || !sku) {
    return res.status(400).json({ message: 'Name and SKU are required.' })
  }

  try {
    const avail = Number(available) || 0
    const pend = Number(pending) || 0
    const resv = Number(reserved) || 0
    const itemStatus = status || (avail <= 20 ? 'Low Stock' : 'Normal')

    const result = await pool.query(
      'INSERT INTO inventory (name, sku, available, pending, reserved, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, sku, avail, pend, resv, itemStatus, req.user.id]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

app.put('/api/inventory/:id', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { id } = req.params
  const { available, pending, reserved, status } = req.body

  try {
    const existing = await pool.query('SELECT created_by, created_at FROM inventory WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    if (!enforceEditWindowOrOwnership(req, existing.rows[0])) {
      return res.status(403).json({ message: 'Edit not allowed (ownership or 48-hour window expired).' })
    }

    const avail = available != null ? Number(available) : null
    const autoStatus = avail != null && avail <= 20 ? 'Low Stock' : status

    const result = await pool.query(
      'UPDATE inventory SET available = COALESCE($1, available), pending = COALESCE($2, pending), reserved = COALESCE($3, reserved), status = COALESCE($4, status) WHERE id = $5 RETURNING *',
      [avail, pending != null ? Number(pending) : null, reserved != null ? Number(reserved) : null, autoStatus, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating inventory:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

// CSV Import
app.post('/api/inventory/import', requireRoles(['admin', 'inventory']), async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  const errors = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = row.name
      const sku = row.sku
      if (!name || !sku) {
        errors.push(`Row ${i + 1}: name and sku required`)
        continue
      }
      const avail = Number(row.available) || 0
      const status = row.status || (avail <= 20 ? 'Low Stock' : 'Normal')
      await pool.query(
        'INSERT INTO inventory (name, sku, available, pending, reserved, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [name, sku, avail, Number(row.pending) || 0, Number(row.reserved) || 0, status, req.user.id]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, total: rows.length, errors })
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
  const { rows } = req.body
  if (!rows?.length) return res.status(400).json({ message: 'No rows to import.' })

  let imported = 0
  const errors = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const name = row.name
      const sku = row.sku
      const category = row.category
      const price = row.price
      if (!name || !sku || !category || !price) {
        errors.push(`Row ${i + 1}: name, category, sku, price required`)
        continue
      }
      const productId = row.product_id || `P${String(Date.now()).slice(-6)}${i}`
      const stock = Number(row.stock) || 0
      const status = row.status || (stock <= 20 ? 'Low Stock' : 'In Stock')
      await pool.query(
        'INSERT INTO products (product_id, name, category, sku, price, stock, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [productId, name, category, sku, price, stock, status]
      )
      imported++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`)
    }
  }
  res.json({ imported, total: rows.length, errors })
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
      const orderNo = row.order_no || `#SO-${Date.now()}${i}`
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
        return { ...code, items }
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
    const breakdown = items.map((item) => ({
      name: item.name,
      sku: item.sku,
      qty_per_unit: item.qty_per_unit,
      total_qty: item.qty_per_unit * multiplier,
      available: item.available,
      in_stock: item.available >= item.qty_per_unit * multiplier,
      display: `${item.name} × ${item.qty_per_unit * multiplier}`,
    }))
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
      await client.query(
        'INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)',
        [codeId, item.inventory_id, Number(item.qty_per_unit) || 1]
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
      'UPDATE product_codes SET code = COALESCE($1, code), name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $4 RETURNING *',
      [code ? code.toUpperCase() : null, name, description, id]
    )
    if (codeRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'Product code not found.' })
    }
    if (items) {
      await client.query('DELETE FROM product_code_items WHERE product_code_id = $1', [id])
      for (const item of items) {
        await client.query(
          'INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)',
          [id, item.inventory_id, Number(item.qty_per_unit) || 1]
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
