import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(plain, stored) {
  if (stored.startsWith('$2')) {
    return bcrypt.compare(plain, stored)
  }
  return plain === stored
}

export function isHashed(password) {
  return password.startsWith('$2')
}
