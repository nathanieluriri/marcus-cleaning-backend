import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'

/**
 * Final-review fix — banner write enforcement.
 *
 * `/api/v1/banners/*` write routes sat outside the `/api/v1/admins/*`
 * enforcement mount: `requireAdmin()` alone only checks "is this an
 * authenticated, non-locked-out admin" — it never consulted the caller's
 * permissionList/preset, so ANY admin (including one on a preset without
 * content permissions, or one still `mustChangePassword`-locked) could
 * write banners. `bannerPermissionGuard` closes that gap; this exercises it
 * on a minimal Hono app the same way admin-permission-guard.test.ts does.
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
import { bannerPermissionGuard, getBannerRouteKeys, matchBannerRouteKey } from '@/server/security/admin-permission-guard'
import { expandPreset } from '@/server/security/admin-presets'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

function makeApp() {
  const app = new Hono<Env>()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ code: err.code, details: err.details ?? null }, err.httpStatus as ContentfulStatusCode)
    }
    return c.json({ code: 'INTERNAL_ERROR', details: String(err) }, 500)
  })
  app.use('/api/v1/banners/*', bannerPermissionGuard())
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

describe('public banner reads', () => {
  it('GET / and GET /{id} pass through with no auth at all (guard skips GET)', async () => {
    expect((await call('GET', '/api/v1/banners')).status).toBe(200)
    expect((await call('GET', '/api/v1/banners/abc123')).status).toBe(200)
  })

  it('OPTIONS passes without auth', async () => {
    expect((await call('OPTIONS', '/api/v1/banners')).status).toBe(200)
  })
})

describe('banner write enforcement', () => {
  it('a write with no token is 401', async () => {
    expect((await call('POST', '/api/v1/banners')).status).toBe(401)
  })

  it('an admin whose preset lacks content permissions is 403 FORBIDDEN', async () => {
    // e.g. operations_only / support_only / finance_only — none grant banner writes.
    const admin = seedAdmin({ permissionList: expandPreset('operations_only') })
    const token = await tokenFor(admin)
    const res = await call('POST', '/api/v1/banners', token)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  it('content_support preset can create, update, and delete banners', async () => {
    const admin = seedAdmin({ permissionList: expandPreset('content_support') })
    const token = await tokenFor(admin)
    expect((await call('POST', '/api/v1/banners', token)).status).toBe(200)
    expect((await call('PATCH', '/api/v1/banners/abc123', token)).status).toBe(200)
    expect((await call('DELETE', '/api/v1/banners/abc123', token)).status).toBe(200)
  })

  it("a '*' wildcard permission can write banners", async () => {
    const admin = seedAdmin({ permissionList: ['*'] })
    expect((await call('POST', '/api/v1/banners', await tokenFor(admin))).status).toBe(200)
  })

  it('isSuperAdmin can write banners regardless of permissionList', async () => {
    const admin = seedAdmin({ isSuperAdmin: true, permissionList: [] })
    expect((await call('POST', '/api/v1/banners', await tokenFor(admin))).status).toBe(200)
  })

  it('a mustChangePassword-locked admin is 403 even with content_support permissions', async () => {
    const admin = seedAdmin({ mustChangePassword: true, permissionList: expandPreset('content_support') })
    const token = await tokenFor(admin)
    const res = await call('POST', '/api/v1/banners', token)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('a mustChangePassword-locked super admin is still blocked from writing banners', async () => {
    const admin = seedAdmin({ mustChangePassword: true, isSuperAdmin: true, permissionList: ['*'] })
    const token = await tokenFor(admin)
    const res = await call('POST', '/api/v1/banners', token)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')
  })
})

describe('banner route key helpers', () => {
  it('derives POST/PATCH/DELETE keys but never GET', () => {
    const keys = getBannerRouteKeys()
    expect(keys).toContain('POST:/api/v1/banners')
    expect(keys.some((k) => k.startsWith('PATCH:/api/v1/banners/'))).toBe(true)
    expect(keys.some((k) => k.startsWith('DELETE:/api/v1/banners/'))).toBe(true)
    expect(keys.some((k) => k.startsWith('GET:'))).toBe(false)
  })

  it('matchBannerRouteKey resolves a concrete write path', () => {
    expect(matchBannerRouteKey('POST', '/api/v1/banners')).toBe('POST:/api/v1/banners')
    expect(matchBannerRouteKey('PATCH', '/api/v1/banners/abc123')).not.toBeNull()
    expect(matchBannerRouteKey('GET', '/api/v1/banners')).toBeNull()
  })
})
