import pool from '../db.js'

console.log('Dropping inventory (CASCADE will remove product_code_items links)...')
await pool.query('DROP TABLE IF EXISTS inventory CASCADE')

console.log('Creating inventory table...')
await pool.query(`
  CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    available INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    required_qty INTEGER DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'Defect',
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)

// Recreate product_code_items if it was dropped by CASCADE dependency edge cases
await pool.query(`
  CREATE TABLE IF NOT EXISTS product_code_items (
    id SERIAL PRIMARY KEY,
    product_code_id INTEGER NOT NULL REFERENCES product_codes(id) ON DELETE CASCADE,
    inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    qty_per_unit INTEGER NOT NULL DEFAULT 1,
    UNIQUE(product_code_id, inventory_id)
  )
`)

const count = await pool.query('SELECT COUNT(*)::int AS c FROM inventory')
console.log('Done. Inventory rows:', count.rows[0].c)
console.log('Fresh empty inventory table is ready.')
await pool.end()
