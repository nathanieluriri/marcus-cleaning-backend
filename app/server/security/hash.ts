import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

/**
 * Password hashing (bcrypt) + refresh-token hashing (sha256).
 * Ported from `security/hash.py`.
 *
 * - Passwords are low-entropy → bcrypt (slow, salted).
 * - Refresh tokens are high-entropy random → plain sha256 is sufficient and
 *   enables an indexed equality lookup. See: ../../../docs/migration/03-auth.md
 */

const BCRYPT_ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed)
}

/** Generate a high-entropy opaque refresh token (base64url). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
