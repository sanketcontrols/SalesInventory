import fs from 'fs'
import XLSX from 'xlsx'
import pool from '../db.js'

const FILE = process.argv[2] || 'c:/Users/Admin/Downloads/StkSum.xlsx'

function makeSku(name, index) {
  const base = String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `${base || 'ITEM'}-${String(index).padStart(3, '0')}`
}

function isSkipName(name) {
  if (!name) return true
  if (/^grand total$/i.test(name)) return true
  if (/^stock$/i.test(name)) return true
  if (/^particulars$/i.test(name)) return true
  if (/^closing balance$/i.test(name)) return true
  if (/^quantity$/i.test(name)) return true
  if (/^rate$/i.test(name)) return true
  if (/^value$/i.test(name)) return true
  if (/^\d+$/.test(name)) return true
  return false
}

function parseParticulars(filePath) {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  const items = []
  const seen = new Set()

  for (let i = 12; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim()
    if (isSkipName(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(name)
  }
  return items
}

async function main() {
  console.log('1) Clearing inventory table...')
  await pool.query('DELETE FROM product_code_items')
  await pool.query('TRUNCATE TABLE inventory RESTART IDENTITY CASCADE')
  // Recreate product_code_items (TRUNCATE CASCADE may drop dependents on some setups)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_code_items (
      id SERIAL PRIMARY KEY,
      product_code_id INTEGER NOT NULL REFERENCES product_codes(id) ON DELETE CASCADE,
      inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      qty_per_unit INTEGER NOT NULL DEFAULT 1,
      UNIQUE(product_code_id, inventory_id)
    )
  `)
  const invCount = await pool.query('SELECT COUNT(*)::int AS c FROM inventory')
  console.log('   Inventory rows now:', invCount.rows[0].c)

  if (!fs.existsSync(FILE)) {
    console.error('File not found:', FILE)
    process.exit(1)
  }

  const names = parseParticulars(FILE)
  console.log(`2) Importing ${names.length} Particulars into products table (no qty/rate/value)...`)

  let inserted = 0
  let skipped = 0

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const existing = await pool.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])
    if (existing.rows[0]) {
      skipped++
      continue
    }

    const sku = makeSku(name, i + 1)
    const productId = `P${String(i + 1).padStart(4, '0')}`
    await pool.query(
      `INSERT INTO products (product_id, name, category, sku, price, stock, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, name, 'General', sku, '₹ 0', 0, 'In Stock']
    )
    inserted++
  }

  const total = await pool.query('SELECT COUNT(*)::int AS c FROM products')
  console.log(`Done. Products inserted: ${inserted}, skipped: ${skipped}, total products: ${total.rows[0].c}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
