import { beforeAll, describe, expect, it } from 'vitest'

// Configure env before any settings-dependent module is imported.
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456'
process.env.JWT_ISSUER = 'marcus-backend-test'
process.env.MONGODB_URI = 'mongodb://localhost:27017'
process.env.DB_NAME = 'marcus_test'
process.env.PAYMENT_DEFAULT_PROVIDER = 'test'
process.env.STORAGE_BACKEND = 'local'

describe('access token sign/verify', () => {
  let jwt: typeof import('@/server/security/jwt')

  beforeAll(async () => {
    jwt = await import('@/server/security/jwt')
  })

  it('signs and verifies an access token for the correct audience', async () => {
    const token = await jwt.signAccessToken({
      sub: 'user-1',
      role: 'customer',
      audience: 'customer-mobile',
      sessionId: 'sess-1',
    })
    const claims = await jwt.verifyAccessToken(token, 'customer-mobile')
    expect(claims.sub).toBe('user-1')
    expect(claims.role).toBe('customer')
    expect(claims.sessionId).toBe('sess-1')
  })

  it('rejects a token presented to the wrong audience', async () => {
    const token = await jwt.signAccessToken({
      sub: 'user-1',
      role: 'customer',
      audience: 'customer-mobile',
      sessionId: 'sess-1',
    })
    await expect(jwt.verifyAccessToken(token, 'admin-web')).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    })
  })

  it('peekAccessClaims reads role/sub without audience enforcement', async () => {
    const token = await jwt.signAccessToken({
      sub: 'user-2',
      role: 'cleaner',
      audience: 'cleaner-mobile',
      sessionId: 'sess-2',
    })
    const peeked = await jwt.peekAccessClaims(token)
    expect(peeked).toEqual({ sub: 'user-2', role: 'cleaner' })
  })

  it('peekAccessClaims returns null for garbage', async () => {
    expect(await jwt.peekAccessClaims('not-a-jwt')).toBeNull()
  })
})

describe('refresh request alias handling', () => {
  it('accepts camelCase and snake_case refresh token fields', async () => {
    const { RefreshRequest, readRefreshToken } = await import('@/server/schemas/auth')
    expect(readRefreshToken(RefreshRequest.parse({ refreshToken: 'abc' }))).toBe('abc')
    expect(readRefreshToken(RefreshRequest.parse({ refresh_token: 'xyz' }))).toBe('xyz')
    expect(() => RefreshRequest.parse({})).toThrow()
  })
})
