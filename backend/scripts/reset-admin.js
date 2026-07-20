import pool from '../db.js'
import { hashPassword } from '../utils/password.js'

const email = 'harsh@gmail.com'
const name = 'Harsh'
const password = '123456'

async function main() {
  const hash = await hashPassword(password)

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  let harshId

  if (existing.rows.length === 0) {
    const ins = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hash, 'admin']
    )
    harshId = ins.rows[0].id
  } else {
    harshId = existing.rows[0].id
    await pool.query('UPDATE users SET name = $1, password = $2, role = $3 WHERE id = $4', [
      name,
      hash,
      'admin',
      harshId,
    ])
  }

  await pool.query('UPDATE orders SET created_by = $1', [harshId])
  await pool.query('UPDATE customers SET created_by = $1', [harshId])
  await pool.query('UPDATE inventory SET created_by = $1', [harshId])

  const del = await pool.query('DELETE FROM users WHERE id <> $1 RETURNING email', [harshId])
  console.log('Admin ready:', email, '(id', harshId + ')')
  console.log('Password:', password)
  console.log('Deleted:', del.rows.map((r) => r.email).join(', ') || '(none)')

  const check = await pool.query('SELECT id, name, email, role FROM users')
  console.log('Users now:', check.rows)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
