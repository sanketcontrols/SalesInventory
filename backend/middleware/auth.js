import jwt from 'jsonwebtoken'
import pool from '../db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'billing-system-dev-secret-change-in-production'

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET)
    // Always use the latest role from DB (admin role changes should apply immediately).
    const dbUser = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id])
    if (dbUser.rows[0]?.role) {
      decoded.role = dbUser.rows[0].role
    }
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' })
  }
}
