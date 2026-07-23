import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(plain, stored) {
  if (stored == null || stored === '') return false
  const hash = String(stored)
  if (hash.startsWith('$2')) {
    return bcrypt.compare(plain, hash)
  }
  return plain === hash
}

export function isHashed(password) {
  return Boolean(password) && String(password).startsWith('$2')
}
