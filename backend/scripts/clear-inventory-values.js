import pool from '../db.js'

const before = await pool.query(
  `SELECT COUNT(*)::int AS c,
          COALESCE(SUM(available),0)::int AS avail,
          COALESCE(SUM(pending),0)::int AS pend,
          COALESCE(SUM(reserved),0)::int AS res
   FROM inventory`
)
console.log('Before:', before.rows[0])

const result = await pool.query(`
  UPDATE inventory SET
    available = 0,
    pending = 0,
    reserved = 0,
    required_qty = 0,
    status = 'Defect',
    updated_at = CURRENT_TIMESTAMP
`)
console.log('Rows updated:', result.rowCount)

const after = await pool.query(
  `SELECT COUNT(*)::int AS c,
          COALESCE(SUM(available),0)::int AS avail,
          COALESCE(SUM(pending),0)::int AS pend,
          COALESCE(SUM(reserved),0)::int AS res
   FROM inventory`
)
console.log('After:', after.rows[0])
await pool.end()
