import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

/**
 * Route-level coverage for Task 4 (httpOnly cookie sessions + change-password):
 *  - Set-Cookie on verify-otp / refresh / legacy-login
 *  - cookie-only auth accepted by the admin guard
 *  - refresh reads the admin_refresh cookie when the body has no token
 *  - POST /logout clears both cookies (Max-Age=0)
 *  - POST /change-password matrix
 *  - tokens are null in the body unless X-Auth-Include-Tokens: 1 is sent
 *
 * Repos/services are mocked per the password-reset.test.ts / admin-otp-login.test.ts
 * pattern (no Mongo). JWTs are signed for real so the admin guard's
 * verifyAccessToken exercises real signature/audience checks.
 */

interface AdminDocFixture {
  _id: string
  firstName: string
  lastName: string
  email: string
  password: string
  accountStatus: string
  isSuperAdmin: boolean
  permissionList: string[]
  preferredLanguage: 'en' | 'fr'
  mustChangePassword?: boolean
  tempPasswordExpiresAt?: number | null
  totpEnabledAt?: number | null
  dateCreated: number
  lastUpdated: number
}

const adminsStore = new Map<string, AdminDocFixture>()
const SESSION_ID = 'sess-1'
const REFRESH_TOKEN = 'refresh-raw-token'
const REFRESH_TOKEN_2 = 'refresh-raw-token-2'

function toOut(doc: AdminDocFixture) {
  return {
    id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    accountStatus: doc.accountStatus,
    isSuperAdmin: doc.isSuperAdmin,
    permissionList: doc.permissionList,
    preferredLanguage: doc.preferredLanguage,
    accessPreset: null,
    mustChangePassword: doc.mustChangePassword ?? false,
    totpEnabled: doc.totpEnabledAt != null,
    dateCreated: doc.dateCreated,
    lastUpdated: doc.lastUpdated,
  }
}

vi.mock('@/server/repositories/admin-repo', () => ({
  findByEmail: vi.fn(async (email: string) => [...adminsStore.values()].find((a) => a.email === email) ?? null),
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  updateLastAuthAt: vi.fn(async () => {}),
  updatePassword: vi.fn(async (id: string, hash: string) => {
    const a = adminsStore.get(id)
    if (a) a.password = hash
  }),
  updateAdmin: vi.fn(async (id: string, patch: Partial<AdminDocFixture>) => {
    const a = adminsStore.get(id)
    if (a) Object.assign(a, patch)
  }),
  toAdminOut: vi.fn((doc: AdminDocFixture) => toOut(doc)),
}))

vi.mock('@/server/services/admin-otp-service', () => ({
  createChallenge: vi.fn(async () => {
    throw new Error('not used in these tests')
  }),
  verifyChallenge: vi.fn(async ({ challengeId, code }: { challengeId: string; code: string }) => {
    const admin = [...adminsStore.values()].find((a) => a._id === challengeId)
    if (!admin || code !== 'GOOD') {
      const { AppError } = await import('@/server/core/errors')
      throw new AppError(401, 'OTP_INVALID', 'Invalid or expired code')
    }
    const { signAccessToken } = await import('@/server/security/jwt')
    const accessToken = await signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })
    return { admin: toOut(admin), accessToken, refreshToken: REFRESH_TOKEN, expiresIn: 900, language: admin.preferredLanguage }
  }),
}))

vi.mock('@/server/services/auth-session-service', () => ({
  issueSession: vi.fn(async ({ userId }: { userId: string }) => {
    const { signAccessToken } = await import('@/server/security/jwt')
    const accessToken = await signAccessToken({ sub: userId, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })
    return { accessToken, refreshToken: REFRESH_TOKEN, expiresIn: 900, sessionId: SESSION_ID }
  }),
  rotateRefresh: vi.fn(async ({ presentedToken }: { presentedToken: string }) => {
    if (presentedToken !== REFRESH_TOKEN) {
      const { authInvalidToken } = await import('@/server/core/errors')
      throw authInvalidToken({ reason: 'Unknown refresh token' })
    }
    const admin = [...adminsStore.values()][0]
    const { signAccessToken } = await import('@/server/security/jwt')
    const accessToken = await signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })
    return { accessToken, refreshToken: REFRESH_TOKEN_2, expiresIn: 900, sessionId: SESSION_ID, userId: admin._id, role: 'admin' as const }
  }),
  logoutSession: vi.fn(async () => {}),
  revokeOtherSessions: vi.fn(async () => 2),
  revokeAllSessions: vi.fn(async () => 3),
}))

import { hashPassword } from '@/server/security/hash'

const PASSWORD = 'correct horse battery staple'
let passwordHash: string

function seedEnv() {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
}

function seedAdmin(overrides: Partial<AdminDocFixture> = {}): AdminDocFixture {
  const ts = Math.floor(Date.now() / 1000)
  const doc: AdminDocFixture = {
    _id: overrides._id ?? `admin-${adminsStore.size + 1}`,
    firstName: 'Ada',
    lastName: 'Admin',
    email: overrides.email ?? `admin${adminsStore.size + 1}@example.com`,
    password: passwordHash,
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: [],
    preferredLanguage: 'en',
    dateCreated: ts,
    lastUpdated: ts,
    ...overrides,
  }
  adminsStore.set(doc._id, doc)
  return doc
}

function setCookiesFromResponse(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie()
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

async function buildTestApp() {
  const { createRouter } = await import('@/server/core/router')
  const { admins } = await import('@/server/routes/admins')
  const { fail } = await import('@/server/core/envelope')
  const { AppError } = await import('@/server/core/errors')
  const app = createRouter()
  app.route('/api/v1/admins', admins)
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(fail(c, err.message, err.code, err.details), err.httpStatus as never)
    }
    return c.json(fail(c, 'Internal Server Error', 'INTERNAL_ERROR'), 500)
  })
  return app
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

beforeEach(() => {
  adminsStore.clear()
  vi.clearAllMocks()
  delete process.env.ADMIN_OTP_REQUIRED
  delete process.env.ADMIN_COOKIE_DOMAIN
  vi.stubEnv('NODE_ENV', 'development')
  __resetSettingsCache()
  seedEnv()
})

describe('POST /verify-otp — cookies + token body gating', () => {
  it('sets admin_access and admin_refresh cookies on success', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: admin._id, code: 'GOOD' }),
    })
    expect(res.status).toBe(200)
    const cookies = setCookiesFromResponse(res)
    expect(cookies.some((c) => c.startsWith('admin_access='))).toBe(true)
    expect(cookies.some((c) => c.startsWith('admin_refresh='))).toBe(true)
  })

  it('omits tokens from the response body by default', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: admin._id, code: 'GOOD' }),
    })
    const body = await res.json()
    expect(body.data.tokens).toBeNull()
    expect(body.data.admin.email).toBe(admin.email)
  })

  it('includes tokens in the response body when X-Auth-Include-Tokens: 1 is sent', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Include-Tokens': '1' },
      body: JSON.stringify({ challengeId: admin._id, code: 'GOOD' }),
    })
    const body = await res.json()
    expect(body.data.tokens).toBeTruthy()
    expect(body.data.tokens.accessToken).toEqual(expect.any(String))
  })
})

describe('POST /login — legacy (ADMIN_OTP_REQUIRED=false) sets cookies too', () => {
  it('sets cookies and nulls tokens by default', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'false'
    __resetSettingsCache()
    const admin = seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: PASSWORD }),
    })
    expect(res.status).toBe(200)
    const cookies = setCookiesFromResponse(res)
    expect(cookies.some((c) => c.startsWith('admin_access='))).toBe(true)
    expect(cookies.some((c) => c.startsWith('admin_refresh='))).toBe(true)
    const body = await res.json()
    expect(body.data.tokens).toBeNull()
  })
})

describe('POST /refresh — cookies + cookie fallback', () => {
  it('sets rotated cookies on success (token supplied in body)', async () => {
    seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: REFRESH_TOKEN }),
    })
    expect(res.status).toBe(200)
    const cookies = setCookiesFromResponse(res)
    expect(cookies.some((c) => c.startsWith('admin_access='))).toBe(true)
    expect(cookies.some((c) => c.startsWith('admin_refresh='))).toBe(true)
  })

  it('reads the refresh token from the admin_refresh cookie when the body has none', async () => {
    seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `admin_refresh=${REFRESH_TOKEN}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('rejects when neither body nor cookie carries a refresh token', async () => {
    seedAdmin()
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })
})

describe('admin guard — cookie fallback', () => {
  it('accepts a request authenticated only via the admin_access cookie (no Authorization header)', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const { signAccessToken } = await import('@/server/security/jwt')
    const token = await signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })

    const res = await app.request('/api/v1/admins/profile', {
      headers: { Cookie: `admin_access=${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.email).toBe(admin.email)
  })
})

describe('POST /logout — dedicated cookie-clearing admin logout', () => {
  it('clears both cookies (Max-Age=0) and revokes the session', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const { signAccessToken } = await import('@/server/security/jwt')
    const token = await signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })

    const res = await app.request('/api/v1/admins/logout', {
      method: 'POST',
      headers: { Cookie: `admin_access=${token}; admin_refresh=${REFRESH_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const cookies = setCookiesFromResponse(res)
    const access = cookies.find((c) => c.startsWith('admin_access='))!
    const refresh = cookies.find((c) => c.startsWith('admin_refresh='))!
    expect(access).toMatch(/Max-Age=0/)
    expect(refresh).toMatch(/Max-Age=0/)

    const { logoutSession } = await import('@/server/services/auth-session-service')
    expect(logoutSession).toHaveBeenCalledWith(admin._id, SESSION_ID)
  })

  it('leaves the generic /sessions/logout route untouched', async () => {
    const admins = (await import('@/server/routes/admins')).admins
    expect(admins.routes.some((r) => r.method === 'POST' && r.path === '/sessions/logout')).toBe(true)
    expect(admins.routes.some((r) => r.method === 'POST' && r.path === '/logout')).toBe(true)
  })
})

describe('POST /change-password', () => {
  async function tokenFor(admin: AdminDocFixture) {
    const { signAccessToken } = await import('@/server/security/jwt')
    return signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: SESSION_ID })
  }

  it('rejects a wrong current password', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const token = await tokenFor(admin)
    const res = await app.request('/api/v1/admins/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'brand-new-password' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.data.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a new password shorter than 8 characters (422 validation)', async () => {
    const admin = seedAdmin()
    const app = await buildTestApp()
    const token = await tokenFor(admin)
    const res = await app.request('/api/v1/admins/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'short' }),
    })
    expect(res.status).toBe(422)
  })

  it('on success: hashes the new password, clears mustChangePassword/tempPasswordExpiresAt, revokes other sessions', async () => {
    const admin = seedAdmin({ mustChangePassword: true, tempPasswordExpiresAt: Math.floor(Date.now() / 1000) + 60 })
    const app = await buildTestApp()
    const token = await tokenFor(admin)
    const res = await app.request('/api/v1/admins/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'brand-new-password' }),
    })
    expect(res.status).toBe(200)

    const { updatePassword, updateAdmin } = await import('@/server/repositories/admin-repo')
    expect(updatePassword).toHaveBeenCalledWith(admin._id, expect.any(String))
    expect(updateAdmin).toHaveBeenCalledWith(admin._id, expect.objectContaining({ mustChangePassword: false, tempPasswordExpiresAt: null }))

    const { revokeOtherSessions } = await import('@/server/services/auth-session-service')
    expect(revokeOtherSessions).toHaveBeenCalledWith(admin._id, SESSION_ID)

    const { verifyPassword } = await import('@/server/security/hash')
    expect(await verifyPassword('brand-new-password', admin.password)).toBe(true)
  })

  it('requires authentication', async () => {
    const app = await buildTestApp()
    const res = await app.request('/api/v1/admins/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'brand-new-password' }),
    })
    expect(res.status).toBe(401)
  })
})
