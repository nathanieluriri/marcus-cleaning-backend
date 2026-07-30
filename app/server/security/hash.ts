import bcrypt from 'bcryptjs'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

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

/**
 * Constant-time string comparison. Ordinary `===`/hash comparisons short-circuit
 * on the first differing byte, which leaks a timing signal an attacker can use
 * to recover a secret one character at a time — unacceptable for OTP/TOTP/dev-code
 * comparisons even though the underlying values are short-lived.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
