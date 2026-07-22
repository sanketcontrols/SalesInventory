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
  if (/^\d+$/.test(name)) return true // HSN / numeric codes under items
  return false
}

/** Parse StkSum.xlsx — Particulars column only (ignore Quantity / Rate / Value) */
function parseParticularsOnly(filePath) {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  const items = []
  const seen = new Set()

  // Data starts after header rows (Particulars / Quantity Rate Value)
  for (let i = 12; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim()
    if (isSkipName(name)) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    items.push({ name })
  }

  return items
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error('File not found:', FILE)
    process.exit(1)
  }

  const items = parseParticularsOnly(FILE)
  console.log(`Parsed ${items.length} product names from Particulars (qty/rate/value ignored)`)

  let inserted = 0
  let skipped = 0

  for (let i = 0; i < items.length; i++) {
    const { name } = items[i]
    const existing = await pool.query('SELECT id FROM inventory WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])

    if (existing.rows[0]) {
      skipped++
      continue
    }

    const sku = makeSku(name, i + 1)
    await pool.query(
      `INSERT INTO inventory (name, sku, available, pending, reserved, required_qty, status, created_by, updated_at)
       VALUES ($1, $2, 0, 0, 0, 0, 'Defect', 1, CURRENT_TIMESTAMP)`,
      [name, sku]
    )
    inserted++
  }

  const total = await pool.query('SELECT COUNT(*)::int AS count FROM inventory')
  console.log(`Done. Inserted: ${inserted}, Already existed: ${skipped}, Total inventory: ${total.rows[0].count}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
