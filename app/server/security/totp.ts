import { createHmac, randomBytes } from 'node:crypto'
import { timingSafeStringEqual } from './hash'

/**
 * Hand-rolled TOTP (RFC 6238) over HMAC-SHA1 (RFC 4226) + base32 (RFC 4648 §6,
 * no padding). No dependency — `node:crypto` covers HMAC; base32 has no
 * built-in `Buffer` encoding so it's implemented here.
 *
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md (Task 3)
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Encode raw bytes as base32 (RFC 4648 §6), no padding. */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return output
}

/** Decode a base32 (RFC 4648 §6) string — case-insensitive, padding/whitespace tolerant. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Generate a fresh TOTP secret: 20 random bytes, base32-encoded. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuf = Buffer.alloc(8)
  // Counter is a 64-bit big-endian integer; JS numbers are safe up to 2^53,
  // far beyond any realistic TOTP counter value, so a plain split is fine.
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  counterBuf.writeUInt32BE(counter >>> 0, 4)

  const hmac = createHmac('sha1', secret).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const code = String(binCode % 10 ** digits)
  return code.padStart(digits, '0')
}

export interface TotpCodeOptions {
  timestamp?: number // epoch seconds
  step?: number // seconds per time step
  digits?: number
}

/** Compute the TOTP code for `secretBase32` at the given (or current) time. */
export function totpCode(secretBase32: string, opts: TotpCodeOptions = {}): string {
  const { timestamp = Math.floor(Date.now() / 1000), step = 30, digits = 6 } = opts
  const counter = Math.floor(timestamp / step)
  return hotp(base32Decode(secretBase32), counter, digits)
}

export interface VerifyTotpOptions {
  timestamp?: number
  step?: number
  digits?: number
  window?: number // steps of clock-skew tolerance, checked on both sides
}

/** Verify `code` against `secretBase32`, tolerating ±`window` time steps of clock skew. */
export function verifyTotp(secretBase32: string, code: string, opts: VerifyTotpOptions = {}): boolean {
  const { timestamp = Math.floor(Date.now() / 1000), step = 30, digits = 6, window = 1 } = opts
  const normalized = code.trim()
  if (!normalized) return false
  // Accumulate across every window candidate rather than early-returning on
  // the first match — evaluating all of them keeps the total comparison work
  // (and thus the timing profile) independent of which offset, if any,
  // matched, on top of the constant-time comparison itself.
  let matched = false
  for (let offset = -window; offset <= window; offset++) {
    const candidateTimestamp = timestamp + offset * step
    if (candidateTimestamp < 0) continue
    const candidate = totpCode(secretBase32, { timestamp: candidateTimestamp, step, digits })
    matched = timingSafeStringEqual(candidate, normalized) || matched
  }
  return matched
}

export interface OtpauthUriArgs {
  secret: string
  accountName: string
  issuer?: string
  digits?: number
  step?: number
}

/** Build an `otpauth://totp/...` URI for QR-code enrollment (Google Authenticator format). */
export function otpauthUri(args: OtpauthUriArgs): string {
  const issuer = args.issuer ?? 'Marcus Cleaning Admin'
  const label = encodeURIComponent(`${issuer}:${args.accountName}`)
  const params = new URLSearchParams({
    secret: args.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(args.digits ?? 6),
    period: String(args.step ?? 30),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
