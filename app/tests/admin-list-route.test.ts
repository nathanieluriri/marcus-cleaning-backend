import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'

/**
 * GET /api/v1/admins/ — list admins (Team page backing route). Closes the gap
 * where `adminRepo.listAdmins`/`toAdminOut` existed but no route served them.
 *
 * Two layers, mirroring existing conventions:
 *  - service-level (admin-invites.test.ts / admin-presets.test.ts pattern):
 *    mocked repo, asserts the wrapped {items, total} shape and that
 *    password/totpSecret/backupCodes never leak through toAdminOut.
 *  - mount-level guard (admin-permission-guard.test.ts pattern): a minimal
 *    Hono app wiring the real adminPermissionGuard() + the real adminCore
 *    router, proving route registration, catalog resolution, and that a
 *    non-privileged preset is 403'd while a wildcard/super-admin passes.
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

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
  accessPreset?: string | null
  mustChangePassword?: boolean
  totpSecret?: string | null
  backupCodes?: string[]
  dateCreated: number
  lastUpdated: number
}

const adminsStore = new Map<string, AdminDocFixture>()

function toAdminOutImpl(doc: AdminDocFixture) {
  // Mirrors the real toAdminOut projection — must never include password,
  // totpSecret or backupCodes.
  return {
    id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    accountStatus: doc.accountStatus,
    isSuperAdmin: doc.isSuperAdmin,
    permissionList: doc.permissionList,
    preferredLanguage: doc.preferredLanguage,
    accessPreset: doc.accessPreset ?? null,
    mustChangePassword: doc.mustChangePassword ?? false,
    totpEnabled: doc.totpSecret != null,
    dateCreated: doc.dateCreated,
    lastUpdated: doc.lastUpdated,
  }
}

vi.mock('@/server/repositories/admin-repo', () => ({
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  listAdmins: vi.fn(async (opts: { limit?: number; skip?: number } = {}) => {
    const all = [...adminsStore.values()].sort((a, b) => (a._id < b._id ? 1 : -1))
    const skip = Math.max(opts.skip ?? 0, 0)
    const limit = opts.limit ?? 50
    return { items: all.slice(skip, skip + limit), total: all.length }
  }),
  toAdminOut: vi.fn((doc: AdminDocFixture) => toAdminOutImpl(doc)),
}))

import { Hono } from 'hono'
import type { Env } from '@/server/core/http-env'
import { AppError } from '@/server/core/errors'
import { __resetSettingsCache } from '@/server/core/settings'
import { signAccessToken } from '@/server/security/jwt'
import {
  adminPermissionGuard,
  matchAdminRouteKey,
  __resetAdminRouteCatalog,
} from '@/server/security/admin-permission-guard'
import { expandPreset } from '@/server/security/admin-presets'
import { adminCore } from '@/server/routes/admin-core'
import * as mgmt from '@/server/services/admin-management-service'
import * as adminRepo from '@/server/repositories/admin-repo'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

function seedAdmin(overrides: Partial<AdminDocFixture> = {}): AdminDocFixture {
  const id = overrides._id ?? `admin-${adminsStore.size + 1}`
  const admin: AdminDocFixture = {
    _id: id,
    firstName: 'Jane',
    lastName: 'Doe',
    email: `${id}@example.com`,
    password: 'bcrypt-hash-should-never-leak',
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: [],
    preferredLanguage: 'en',
    totpSecret: 'BASE32SECRETSHOULDNEVERLEAK',
    backupCodes: ['sha256-hash-1', 'sha256-hash-2'],
    dateCreated: 1700000000,
    lastUpdated: 1700000000,
    ...overrides,
  }
  adminsStore.set(id, admin)
  return admin
}

async function tokenFor(admin: AdminDocFixture): Promise<string> {
  return signAccessToken({ sub: admin._id, role: 'admin', audience: 'admin-web', sessionId: 'sess-1' })
}

beforeAll(() => {
  __resetSettingsCache()
  __resetAdminRouteCatalog()
})

beforeEach(() => {
  adminsStore.clear()
  vi.clearAllMocks()
})

describe('admin-management-service — listAdmins', () => {
  it('delegates {limit, skip} to adminRepo.listAdmins and maps every item through toAdminOut', async () => {
    seedAdmin({ _id: 'a1' })
    seedAdmin({ _id: 'a2' })

    const result = await mgmt.listAdmins({ limit: 10, skip: 0 })

    expect(adminRepo.listAdmins).toHaveBeenCalledWith({ limit: 10, skip: 0 })
    expect(adminRepo.toAdminOut).toHaveBeenCalledTimes(2)
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.items.map((i) => i.id).sort()).toEqual(['a1', 'a2'])
  })

  it('never leaks password, totpSecret or backupCodes on any returned item', async () => {
    seedAdmin({ _id: 'a1', password: 'hunter2-hash' })

    const { items } = await mgmt.listAdmins({})

    expect(items).toHaveLength(1)
    for (const item of items) {
      expect(item).not.toHaveProperty('password')
      expect(item).not.toHaveProperty('totpSecret')
      expect(item).not.toHaveProperty('backupCodes')
    }
  })
})

describe('adminCore route registration', () => {
  it('registers GET / (list admins)', () => {
    const hasRoute = adminCore.routes.some((r) => r.method.toUpperCase() === 'GET' && r.path === '/')
    expect(hasRoute).toBe(true)
  })

  it('resolves via the derived permission catalog to GET:/api/v1/admins', () => {
    expect(matchAdminRouteKey('GET', '/api/v1/admins')).toBe('GET:/api/v1/admins')
  })
})

describe('GET /api/v1/admins — mount-level guard + real handler', () => {
  function makeApp() {
    const app = new Hono<Env>()
    app.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ code: err.code, details: err.details ?? null }, err.httpStatus as ContentfulStatusCode)
      }
      return c.json({ code: 'INTERNAL_ERROR', details: String(err) }, 500)
    })
    // Same order as server/app.ts: mount-level guard first, then the real router.
    app.use('/api/v1/admins/*', adminPermissionGuard())
    app.route('/api/v1/admins', adminCore)
    return app
  }

  const app = makeApp()

  it('401s with no token', async () => {
    const res = await app.request('/api/v1/admins')
    expect(res.status).toBe(401)
  })

  it('403s a non-privileged preset (operations_only has no admin-management key)', async () => {
    const admin = seedAdmin({ _id: 'ops-1', permissionList: expandPreset('operations_only') })
    const res = await app.request('/api/v1/admins', { headers: { Authorization: `Bearer ${await tokenFor(admin)}` } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
    expect(body.details).toEqual({ required: 'GET:/api/v1/admins' })
  })

  it('200s for the all_controls (wildcard) preset with the wrapped {items, total} envelope', async () => {
    seedAdmin({ _id: 'member-1' })
    seedAdmin({ _id: 'member-2' })
    const caller = seedAdmin({ _id: 'caller-1', permissionList: ['*'] })

    const res = await app.request('/api/v1/admins', { headers: { Authorization: `Bearer ${await tokenFor(caller)}` } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.total).toBe(3) // member-1, member-2, caller-1
    expect(Array.isArray(body.data.items)).toBe(true)
    expect(body.data.items).toHaveLength(3)
    for (const item of body.data.items) {
      expect(item).not.toHaveProperty('password')
      expect(item).not.toHaveProperty('totpSecret')
      expect(item).not.toHaveProperty('backupCodes')
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('email')
    }
  })

  it('200s for isSuperAdmin regardless of permissionList', async () => {
    const admin = seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: [] })
    const res = await app.request('/api/v1/admins', { headers: { Authorization: `Bearer ${await tokenFor(admin)}` } })
    expect(res.status).toBe(200)
  })
})
