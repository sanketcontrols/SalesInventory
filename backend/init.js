import pool from './db.js'
import { hashPassword } from './utils/password.js'

export async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'sales',
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_no VARCHAR(50) UNIQUE NOT NULL,
        company VARCHAR(255) NOT NULL,
        state VARCHAR(100) NOT NULL,
        date VARCHAR(50) NOT NULL,
        qty INTEGER NOT NULL,
        amount VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        orders_count INTEGER DEFAULT 0,
        total_amount VARCHAR(50) NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        sku VARCHAR(100) NOT NULL,
        price VARCHAR(50) NOT NULL,
        stock INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) NOT NULL,
        available INTEGER NOT NULL,
        pending INTEGER NOT NULL,
        reserved INTEGER NOT NULL,
        required_qty INTEGER DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_code_items (
        id SERIAL PRIMARY KEY,
        product_code_id INTEGER NOT NULL REFERENCES product_codes(id) ON DELETE CASCADE,
        inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        qty_per_unit INTEGER NOT NULL DEFAULT 1,
        UNIQUE(product_code_id, inventory_id)
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL DEFAULT 'Purn Sanket Electrols',
        address TEXT DEFAULT '',
        gst_no VARCHAR(50) DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    console.log('Database tables created successfully')

    // RBAC + ownership columns (safe for existing DBs)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'sales'`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by INTEGER`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by INTEGER`)
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS gst_no VARCHAR(50) DEFAULT ''`)
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''`)
    await pool.query(`ALTER TABLE customers ALTER COLUMN phone TYPE VARCHAR(50)`)
    await pool.query(`ALTER TABLE customers ALTER COLUMN email TYPE VARCHAR(255)`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS created_by INTEGER`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS required_qty INTEGER DEFAULT 0`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS rate NUMERIC(14, 2) NOT NULL DEFAULT 0`)
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stock_target INTEGER`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_rate_history (
        id SERIAL PRIMARY KEY,
        inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        rate NUMERIC(14, 2) NOT NULL,
        note TEXT DEFAULT '',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(
      `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS low_stock_target INTEGER NOT NULL DEFAULT 20`
    )
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE product_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
    await pool.query(`ALTER TABLE product_codes ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_stock_movements (
        id SERIAL PRIMARY KEY,
        product_code_id INTEGER NOT NULL REFERENCES product_codes(id) ON DELETE CASCADE,
        label VARCHAR(50) DEFAULT 'Stock',
        qty INTEGER NOT NULL,
        stock_after INTEGER NOT NULL DEFAULT 0,
        movement_date VARCHAR(50) NOT NULL,
        note TEXT DEFAULT '',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_code_id INTEGER`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_code VARCHAR(50)`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name VARCHAR(255)`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_booked BOOLEAN DEFAULT FALSE`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_of_days INTEGER DEFAULT 0`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ok_to_mfg BOOLEAN DEFAULT FALSE`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`)
    // Backfill closing time for already completed/cancelled orders
    await pool.query(`
      UPDATE orders
      SET closed_at = COALESCE(updated_at, created_at)
      WHERE status IN ('Completed', 'Cancelled')
        AND closed_at IS NULL
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id SERIAL PRIMARY KEY,
        inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        order_no VARCHAR(50) DEFAULT '',
        product_code VARCHAR(50) DEFAULT '',
        qty INTEGER NOT NULL,
        movement_date VARCHAR(50) NOT NULL,
        note TEXT DEFAULT '',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_code_id INTEGER,
        product_code VARCHAR(50),
        product_name VARCHAR(255),
        qty INTEGER NOT NULL DEFAULT 1,
        amount VARCHAR(50) DEFAULT '₹ 0',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monthly_qty_stats (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(20) NOT NULL,
        ref_id INTEGER NOT NULL,
        year_month CHAR(7) NOT NULL,
        qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (kind, ref_id, year_month)
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_monthly_qty_stats_lookup
       ON monthly_qty_stats (kind, ref_id, year_month DESC)`
    )

    await pool.query(`
      UPDATE orders
      SET stock_booked = TRUE
      WHERE product_code_id IS NOT NULL
        AND status <> 'Cancelled'
        AND (stock_booked IS NULL OR stock_booked = FALSE)
    `)

    // Rename legacy inventory status label
    await pool.query(`UPDATE inventory SET status = 'Stock Available' WHERE status = 'Normal'`)
    await pool.query(`UPDATE inventory SET status = 'Defect' WHERE status = 'Critical'`)

    // Ensure primary admin always exists (NAS fresh volume / partial seed)
    await pool.query(`UPDATE users SET role = 'admin' WHERE LOWER(email) = 'harsh@gmail.com'`)

    const adminCheck = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = 'harsh@gmail.com' LIMIT 1`
    )
    if (adminCheck.rows.length === 0) {
      const hashedPassword = await hashPassword('123456')
      await pool.query(
        'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
        ['Harsh', 'harsh@gmail.com', hashedPassword, 'admin']
      )
      console.log('Admin user created (harsh@gmail.com / 123456)')
    }

    // Optional: set RESET_ADMIN_PASSWORD=true in compose to restore 123456
    if (String(process.env.RESET_ADMIN_PASSWORD || '').toLowerCase() === 'true') {
      const hashedPassword = await hashPassword('123456')
      await pool.query(
        `UPDATE users SET password = $1, role = 'admin', name = COALESCE(NULLIF(name, ''), 'Harsh')
         WHERE LOWER(email) = 'harsh@gmail.com'`,
        [hashedPassword]
      )
      console.log('Admin password reset to 123456 (RESET_ADMIN_PASSWORD=true)')
    }

    const unr = await pool.query(
      `SELECT id FROM users WHERE (role IS NULL OR role = '') AND LOWER(email) <> 'harsh@gmail.com' ORDER BY id ASC`
    )
    if (unr.rows.length > 0) {
      await pool.query(`UPDATE users SET role = 'inventory' WHERE id = $1`, [unr.rows[0].id])
      for (let i = 1; i < unr.rows.length; i++) {
        await pool.query(`UPDATE users SET role = 'sales' WHERE id = $1`, [unr.rows[i].id])
      }
    }

    // For old demo data after adding created_by:
    // set created_by to admin so edits are allowed in the first 48 hours.
    const adminIdRes = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = 'harsh@gmail.com' ORDER BY id LIMIT 1`
    )
    const adminId = adminIdRes.rows[0]?.id
    if (adminId) {
      await pool.query(`UPDATE orders SET created_by = $1 WHERE created_by IS NULL`, [adminId])
      await pool.query(`UPDATE customers SET created_by = $1 WHERE created_by IS NULL`, [adminId])
      await pool.query(`UPDATE inventory SET created_by = $1 WHERE created_by IS NULL`, [adminId])
    }

    const userCheck = await pool.query('SELECT COUNT(*) FROM users')
    if (userCheck.rows[0].count === '0') {
      const hashedPassword = await hashPassword('123456')
      await pool.query(
        'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
        ['Harsh', 'harsh@gmail.com', hashedPassword, 'admin']
      )
      console.log('Admin user created (harsh@gmail.com / 123456)')
    } else {
      const plainUsers = await pool.query("SELECT id, password FROM users WHERE password IS NULL OR password NOT LIKE '$2%'")
      for (const user of plainUsers.rows) {
        const hashedPassword = await hashPassword(user.password || '123456')
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id])
      }
      if (plainUsers.rows.length > 0) {
        console.log(`Upgraded ${plainUsers.rows.length} user password(s) to hashed format`)
      }
    }

    const orderCheck = await pool.query('SELECT COUNT(*) FROM orders')
    if (orderCheck.rows[0].count === '0') {
      const demoOrders = [
        ['#SO-1042', 'Northwind Tools', 'Texas', '14 Jul, 2025', 24, '₹ 8,240', 'Pending'],
        ['#SO-1039', 'Apex Components', 'Illinois', '13 Jul, 2025', 16, '₹ 5,120', 'Completed'],
        ['#SO-1035', 'BluePeak Industries', 'Arizona', '12 Jul, 2025', 12, '₹ 3,840', 'Cancelled'],
      ]
      for (const order of demoOrders) {
        await pool.query(
          'INSERT INTO orders (order_no, company, state, date, qty, amount, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [...order, adminId]
        )
      }
      console.log('Demo orders created')
    }

    const customerCheck = await pool.query('SELECT COUNT(*) FROM customers')
    if (customerCheck.rows[0].count === '0') {
      const demoCustomers = [
        ['ABC Electronics Pvt Ltd', 'contact@abc.com', '+91 9876543210', 'Mumbai', 'Maharashtra', 18, '₹ 4,85,600', '27AABCU9603R1ZM', '12 Andheri Industrial Estate, Mumbai'],
        ['XYZ Industries', 'info@xyz.com', '+91 9876543211', 'Delhi', 'Delhi', 12, '₹ 2,80,400', '07AAACX1234D1Z5', 'Plot 8, Okhla Phase II, New Delhi'],
        ['TechFlow Solutions', 'sales@techflow.com', '+91 9876543212', 'Bangalore', 'Karnataka', 8, '₹ 1,92,000', '29AABCT1332L1ZV', '45 Electronic City, Bangalore'],
      ]
      for (const customer of demoCustomers) {
        await pool.query(
          'INSERT INTO customers (name, email, phone, city, state, orders_count, total_amount, gst_no, address, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [...customer, adminId]
        )
      }
      console.log('Demo customers created')
    }

    const productCheck = await pool.query('SELECT COUNT(*) FROM products')
    if (productCheck.rows[0].count === '0') {
      const demoProducts = [
        ['P001', 'Relay 24V', 'Electrical', 'RLY-24V-001', '₹ 450', 120, 'In Stock'],
        ['P002', 'Terminal Block', 'Connectors', 'TRM-BLK-002', '₹ 180', 18, 'Low Stock'],
        ['P003', 'MCB 63A', 'Protection', 'MCB-63A-003', '₹ 320', 35, 'In Stock'],
      ]
      for (const product of demoProducts) {
        await pool.query(
          'INSERT INTO products (product_id, name, category, sku, price, stock, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          product
        )
      }
      console.log('Demo products created')
    }

    const inventoryCheck = await pool.query('SELECT COUNT(*) FROM inventory')
    if (inventoryCheck.rows[0].count === '0') {
      const demoInventory = [
        ['Relay 24V', 'RLY-24V-001', 120, 20, 5, 'Stock Available'],
        ['Terminal Block', 'TRM-BLK-002', 18, 50, 10, 'Low Stock'],
        ['MCB 63A', 'MCB-63A-003', 35, 10, 2, 'Stock Available'],
      ]
      for (const item of demoInventory) {
        await pool.query(
          'INSERT INTO inventory (name, sku, available, pending, reserved, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [...item, adminId]
        )
      }
      console.log('Demo inventory created')
    }

    const settingsCheck = await pool.query('SELECT COUNT(*) FROM company_settings')
    if (settingsCheck.rows[0].count === '0') {
      await pool.query(
        `INSERT INTO company_settings (company_name, address, gst_no) VALUES ($1, $2, $3)`,
        [
          'Purn Sanket Electrols',
          '',
          '',
        ]
      )
      console.log('Default company settings created')
    }

    const codeCheck = await pool.query('SELECT COUNT(*) FROM product_codes')
    if (codeCheck.rows[0].count === '0') {
      const invRows = await pool.query('SELECT id, name, sku FROM inventory ORDER BY id')
      if (invRows.rows.length >= 2) {
        const codeRes = await pool.query(
          `INSERT INTO product_codes (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          ['BRK-001', 'Barrier Kit', 'Standard barrier assembly kit', adminId]
        )
        const codeId = codeRes.rows[0].id
        await pool.query(
          `INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)`,
          [codeId, invRows.rows[0].id, 1]
        )
        await pool.query(
          `INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)`,
          [codeId, invRows.rows[1].id, 2]
        )

        const codeRes2 = await pool.query(
          `INSERT INTO product_codes (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          ['MCB-PKG', 'MCB Protection Pack', 'MCB with terminal blocks', adminId]
        )
        const codeId2 = codeRes2.rows[0].id
        await pool.query(
          `INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)`,
          [codeId2, invRows.rows[2]?.id || invRows.rows[0].id, 1]
        )
        await pool.query(
          `INSERT INTO product_code_items (product_code_id, inventory_id, qty_per_unit) VALUES ($1, $2, $3)`,
          [codeId2, invRows.rows[1].id, 4]
        )
        console.log('Demo product codes created')
      }
    }
  } catch (error) {
    console.error('Database initialization error:', error)
    throw error
  }
}
