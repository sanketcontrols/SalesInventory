import pool from '../db.js'

/**
 * Copy rows from `products` into `product_codes` so they appear on Products page / orders.
 */
async function main() {
  const products = await pool.query('SELECT id, product_id, name, sku FROM products ORDER BY id ASC')
  console.log(`Found ${products.rows.length} rows in products table`)

  let inserted = 0
  let skipped = 0

  for (const p of products.rows) {
    const code = String(p.product_id || p.sku || `P${p.id}`).toUpperCase().slice(0, 50)
    const name = p.name

    const byCode = await pool.query('SELECT id FROM product_codes WHERE UPPER(code) = UPPER($1) LIMIT 1', [code])
    const byName = await pool.query('SELECT id FROM product_codes WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])
    if (byCode.rows[0] || byName.rows[0]) {
      skipped++
      continue
    }

    await pool.query(
      `INSERT INTO product_codes (code, name, description, created_by)
       VALUES ($1, $2, $3, 1)`,
      [code, name, '']
    )
    inserted++
  }

  const total = await pool.query('SELECT COUNT(*)::int AS c FROM product_codes')
  console.log(`Done. Inserted into product_codes: ${inserted}, skipped: ${skipped}, total product_codes: ${total.rows[0].c}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
