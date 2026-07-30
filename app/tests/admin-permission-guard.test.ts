import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'

/**
 * Task 7 — mount-level admin permission enforcement.
 * The guard is exercised on a minimal Hono app (guard + catch-all handler),
 * not the full server, to keep the test light. Repos are mocked; JWTs are
 * signed for real so token verification is exercised end-to-end.
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

interface AdminFixture {
  _id: string
  email: string
  accountStatus: string
  isSuperAdmin: boolean
  permissionList: string[]
  preferredLanguage: 'en' | 'fr'
  mustChangePassword?: boolean
}

const adminsStore = new Map<string, AdminFixture>()

vi.mock('@/server/repositories/admin-repo', () => ({
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  findByEmail: vi.fn(async () => null),
  updateLastAuthAt: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  updateAdmin: vi.fn(async () => {}),
  toAdminOut: vi.fn((doc: AdminFixture) => doc),
}))

import { Hono } from 'hono'
import type { Env } from '@/server/core/http-env'
import { AppError } from '@/server/core/errors'
import { __resetSettingsCache } from '@/server/core/settings'
import { signAccessToken } from '@/server/security/jwt'
import {
  adminPermissionGuard,
  matchAdminRouteKey,
  normalizePermissionKey,
  getAdminRouteKeys,
} from '@/server/security/admin-permission-guard'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

function makeApp() {
  const app = new Hono<Env>()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ code: err.code, details: err.details ?? null }, err.httpStatus as ContentfulStatusCode)
    }
    return c.json({ code: 'INTERNAL_ERROR', details: String(err) }, 500)
  })
  app.use('/api/v1/admins/*', adminPermissionGuard())
  app.all('*', (c) => c.json({ code: 'OK', principal: c.get('principal')?.userId ?? null }))
  return app
}

const app = makeApp()

function seedAdmin(overrides: Partial<AdminFixture> = {}): AdminFixture {
  const admin: AdminFixture = {
    _id: 'admin-1',
    email: 'admin@example.com',
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: [],
    preferredLanguage: 'en',
    ...overrides,
  }
  adminsStore.set(admin._id, admin)
  return admin
}

async function tokenFor(admin: AdminFixture): Promise<string> {
  return signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: 'sess-1' })
}

async function call(method: string, path: string, token?: string) {
  return app.request(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

beforeAll(() => {
  __resetSettingsCache()
})

beforeEach(() => {
  adminsStore.clear()
})

describe('exempt surface', () => {
  it('POST /login passes without any auth', async () => {
    const res = await call('POST', '/api/v1/admins/login')
    expect(res.status).toBe(200)
  })

  it('POST /verify-otp and /refresh pass without auth', async () => {
    expect((await call('POST', '/api/v1/admins/verify-otp')).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/refresh')).status).toBe(200)
  })

  it('OPTIONS passes without auth', async () => {
    expect((await call('OPTIONS', '/api/v1/admins/customers')).status).toBe(200)
  })

  it('a non-exempt route without a token is 401', async () => {
    const res = await call('GET', '/api/v1/admins/customers')
    expect(res.status).toBe(401)
  })
})

describe('permission enforcement', () => {
  it('allows a route whose key is in the permissionList', async () => {
    const admin = seedAdmin({ permissionList: ['GET:/api/v1/admins/customers'] })
    const res = await call('GET', '/api/v1/admins/customers', await tokenFor(admin))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.principal).toBe(admin._id) // principal set for downstream guards
  })

  it('matches :param grants against {param} routes (placeholder-insensitive)', async () => {
    const admin = seedAdmin({ permissionList: ['GET:/api/v1/admins/customers/:customer_id'] })
    const res = await call('GET', '/api/v1/admins/customers/abc123', await tokenFor(admin))
    expect(res.status).toBe(200)
  })

  it('denies with 403 FORBIDDEN and the required key', async () => {
    const admin = seedAdmin({ permissionList: ['GET:/api/v1/admins/cleaners'] })
    const res = await call('GET', '/api/v1/admins/customers', await tokenFor(admin))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
    expect(body.details).toEqual({ required: 'GET:/api/v1/admins/customers' })
  })

  it("a '*' wildcard passes any catalogued route", async () => {
    const admin = seedAdmin({ permissionList: ['*'] })
    expect((await call('GET', '/api/v1/admins/customers', await tokenFor(admin))).status).toBe(200)
    expect((await call('GET', '/api/v1/admins/monitoring/overview', await tokenFor(admin))).status).toBe(200)
  })

  it('isSuperAdmin passes even with an empty permissionList (survives preset downgrade)', async () => {
    const admin = seedAdmin({ isSuperAdmin: true, permissionList: [] })
    const res = await call('GET', '/api/v1/admins/customers', await tokenFor(admin))
    expect(res.status).toBe(200)
  })

  it('fails closed (403, no required detail) for an uncatalogued admin path', async () => {
    const admin = seedAdmin({ permissionList: ['GET:/api/v1/admins/customers'] })
    const res = await call('GET', '/api/v1/admins/not-a-real-route', await tokenFor(admin))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
    expect(body.details).toBeNull()
  })
})

describe('implicit self-service surface', () => {
  it('any authenticated admin can use profile, 2fa, sessions, catalog, presets', async () => {
    const admin = seedAdmin({ permissionList: [] })
    const token = await tokenFor(admin)
    expect((await call('GET', '/api/v1/admins/profile', token)).status).toBe(200)
    expect((await call('PATCH', '/api/v1/admins/profile/language', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/2fa/setup', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/sessions/logout', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/change-password', token)).status).toBe(200)
    expect((await call('GET', '/api/v1/admins/permissions/catalog', token)).status).toBe(200)
    expect((await call('GET', '/api/v1/admins/access-presets', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/logout', token)).status).toBe(200)
    expect((await call('GET', '/api/v1/admins/access/request-elevation/status', token)).status).toBe(200)
  })
})

describe('mustChangePassword lockdown', () => {
  it('allows only change-password, GET profile, sessions and logout', async () => {
    const admin = seedAdmin({ mustChangePassword: true, isSuperAdmin: true, permissionList: ['*'] })
    const token = await tokenFor(admin)
    expect((await call('POST', '/api/v1/admins/change-password', token)).status).toBe(200)
    expect((await call('GET', '/api/v1/admins/profile', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/sessions/logout', token)).status).toBe(200)
    expect((await call('POST', '/api/v1/admins/logout', token)).status).toBe(200)
  })

  it('403 PASSWORD_CHANGE_REQUIRED everywhere else — even for a super admin', async () => {
    const admin = seedAdmin({ mustChangePassword: true, isSuperAdmin: true, permissionList: ['*'] })
    const token = await tokenFor(admin)
    for (const [method, path] of [
      ['GET', '/api/v1/admins/customers'],
      ['POST', '/api/v1/admins/2fa/setup'],
      ['GET', '/api/v1/admins/monitoring/overview'],
    ] as const) {
      const res = await call(method, path, token)
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')
    }
  })
})

describe('key matching helpers', () => {
  it('normalizePermissionKey collapses :param and {param} to the same form', () => {
    expect(normalizePermissionKey('GET:/api/v1/admins/customers/:customer_id')).toBe(
      normalizePermissionKey('GET:/api/v1/admins/customers/{customer_id}'),
    )
  })

  it('matchAdminRouteKey prefers the most-literal (longest) match', () => {
    // /customers/{customer_id}/places vs any broader param pattern
    expect(matchAdminRouteKey('GET', '/api/v1/admins/customers/abc/places')).toBe(
      'GET:/api/v1/admins/customers/{customer_id}/places',
    )
    expect(matchAdminRouteKey('GET', '/api/v1/admins/nope')).toBeNull()
  })

  it('the derived catalog contains routes from every admin router', () => {
    const keys = getAdminRouteKeys()
    expect(keys).toContain('POST:/api/v1/admins/login') // admins
    expect(keys).toContain('GET:/api/v1/admins/customers') // admin-core
    expect(keys).toContain('POST:/api/v1/admins/service-credits/grant') // admin-features
    expect(keys).toContain('GET:/api/v1/admins/applications') // admin-safety
    expect(keys).toContain('GET:/api/v1/admins/notifications/types') // admin-broadcasts
  })
})
