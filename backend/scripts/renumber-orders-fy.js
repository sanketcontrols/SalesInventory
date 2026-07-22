import pool from '../db.js'

/** Renumber all orders to FY26-27_01 style by created_at (oldest first). */
function fyPrefix(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = d.getMonth()
  const startYear = month >= 3 ? year : year - 1
  const endYear = startYear + 1
  return `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}_`
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const { rows } = await client.query(
    `SELECT id, order_no, created_at FROM orders ORDER BY created_at ASC, id ASC`
  )

  for (const row of rows) {
    await client.query(`UPDATE orders SET order_no = $1 WHERE id = $2`, [`__TMP__${row.id}`, row.id])
  }

  const counters = {}
  for (const row of rows) {
    const prefix = fyPrefix(row.created_at)
    counters[prefix] = (counters[prefix] || 0) + 1
    const orderNo = `${prefix}${String(counters[prefix]).padStart(2, '0')}`
    await client.query(`UPDATE orders SET order_no = $1 WHERE id = $2`, [orderNo, row.id])
    console.log(`${row.order_no} → ${orderNo}`)
  }

  await client.query('COMMIT')
  console.log(`Done. Renumbered ${rows.length} orders.`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
