import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, generateSecret, otpauthUri, totpCode, verifyTotp } from '@/server/security/totp'

/**
 * RFC 6238 Appendix B test vectors (SHA-1 only — the ASCII secret
 * '12345678901234567890', repeated/truncated per algorithm in the RFC, but
 * this repo only implements SHA-1). At T=59s, step=30 → time counter 1.
 * The RFC's table lists 8-digit codes; the 6-digit value is the low-order
 * 6 digits of the same HOTP computation (mod 10^6 instead of mod 10^8).
 */
const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'))

describe('base32', () => {
  it('round-trips arbitrary byte buffers', () => {
    const buf = Buffer.from([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255])
    expect(base32Decode(base32Encode(buf))).toEqual(buf)
  })

  it('round-trips a generated secret', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    const decoded = base32Decode(secret)
    expect(decoded.length).toBe(20)
    expect(base32Encode(decoded)).toBe(secret)
  })
})

describe('totpCode — RFC 6238 Appendix B vectors (SHA-1)', () => {
  it('T=59s → 8-digit code 94287082', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 59, digits: 8 })).toBe('94287082')
  })

  it('T=59s → 6-digit code is the low-order 6 digits, 287082', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 59, digits: 6 })).toBe('287082')
  })

  it('T=1111111109s → 8-digit code 07081804', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 1111111109, digits: 8 })).toBe('07081804')
  })

  it('T=1111111111s → 8-digit code 14050471', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 1111111111, digits: 8 })).toBe('14050471')
  })

  it('T=1234567890s → 8-digit code 89005924', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 1234567890, digits: 8 })).toBe('89005924')
  })

  it('T=2000000000s → 8-digit code 69279037', () => {
    expect(totpCode(RFC_SECRET_BASE32, { timestamp: 2000000000, digits: 8 })).toBe('69279037')
  })
})

describe('verifyTotp', () => {
  it('accepts the exact-time code', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, '287082', { timestamp: 59 })).toBe(true)
  })

  it('rejects a wrong code', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, '000000', { timestamp: 59 })).toBe(false)
  })

  it('accepts a code from one step in the past within the default window', () => {
    // step=30 → time counter for 59 is 1; counter for 89 is 2. Verifying at
    // t=89 should still accept the code generated for the previous step.
    expect(verifyTotp(RFC_SECRET_BASE32, '287082', { timestamp: 89 })).toBe(true)
  })

  it('accepts a code from one step in the future within the default window', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, '287082', { timestamp: 29 })).toBe(true)
  })

  it('rejects a code two steps away — outside the default ±1 window', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, '287082', { timestamp: 119 })).toBe(false)
  })

  it('rejects an empty code', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, '', { timestamp: 59 })).toBe(false)
  })
})

describe('otpauthUri', () => {
  it('builds a valid otpauth:// URI with issuer, account and secret', () => {
    const uri = otpauthUri({ secret: RFC_SECRET_BASE32, accountName: 'admin@example.com' })
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain(encodeURIComponent('Marcus Cleaning Admin:admin@example.com'))
    expect(uri).toContain(`secret=${RFC_SECRET_BASE32}`)
    expect(uri).toContain('issuer=Marcus+Cleaning+Admin')
  })

  it('allows overriding the issuer', () => {
    const uri = otpauthUri({ secret: RFC_SECRET_BASE32, accountName: 'a@b.com', issuer: 'Custom Co' })
    expect(uri).toContain('issuer=Custom+Co')
  })
})
