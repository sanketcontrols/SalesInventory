/**
 * Remove StkSum product rows wrongly imported into inventory.
 * Keeps inventory parts that are linked on a product BOM.
 */
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

async function main() {
  const before = await pool.query('SELECT COUNT(*)::int AS c FROM inventory')
  const del = await pool.query(`
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
  const after = await pool.query('SELECT COUNT(*)::int AS c FROM inventory')
  console.log(
    JSON.stringify(
      {
        before: before.rows[0].c,
        deleted: del.rowCount,
        after: after.rows[0].c,
        sample: del.rows.slice(0, 20).map((r) => r.name),
      },
      null,
      2
    )
  )
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
