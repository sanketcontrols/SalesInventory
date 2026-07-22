import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

function useSsl() {
  if (process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require') return true
  if (process.env.DB_SSL === 'false') return false
  const url = process.env.DATABASE_URL || ''
  // Render / managed Postgres require TLS
  if (/render\.com|amazonaws\.com|neon\.tech|supabase\.co/i.test(url)) return true
  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) return true
  return false
}

function withSsl(config) {
  if (!useSsl()) return config
  return { ...config, ssl: { rejectUnauthorized: false } }
}

function buildPoolConfig() {
  // Prefer individual vars (handles special chars in password like @)
  const host = process.env.DB_HOST || process.env.PGHOST
  const port = process.env.DB_PORT || process.env.PGPORT
  const database = process.env.DB_NAME || process.env.PGDATABASE
  const user = process.env.DB_USER || process.env.PGUSER
  const password = process.env.DB_PASSWORD || process.env.PGPASSWORD

  if (host && database && user) {
    return withSsl({
      host,
      port: Number(port || 5432),
      user,
      password,
      database,
    })
  }

  if (process.env.DATABASE_URL) {
    return withSsl({ connectionString: process.env.DATABASE_URL })
  }

  return {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'password',
    database: 'billing_system',
  }
}

const pool = new Pool(buildPoolConfig())

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message)
})

export default pool
