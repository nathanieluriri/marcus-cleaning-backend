import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'

/**
 * Wire-level contract for the three monitoring list routes.
 *
 * All three were declared `request: { query: AdminListQuery }`, which only defines
 * `limit`/`skip`/`search`. Zod objects drop undeclared keys, so every filter the
 * admin UI sends — the whole audit filter panel, the alert status/unread toggles,
 * the SLA `hours` window — was parsed away before the handler ran.
 *
 * These tests drive real HTTP requests through the real router and assert on the
 * options the repository is handed, so they cover schema parsing, the snake_case
 * wire -> camelCase internal mapping, and the service passthrough together.
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

const listAlerts = vi.fn(async () => ({ items: [], total: 0 }))
const listAuditEvents = vi.fn(async () => ({ items: [], total: 0 }))

vi.mock('@/server/repositories/admin-monitoring-repo', () => ({
  listAlerts: (...args: unknown[]) => listAlerts(...(args as [])),
  listAuditEvents: (...args: unknown[]) => listAuditEvents(...(args as [])),
  getAuditEventById: vi.fn(async () => null),
  setAlertFlag: vi.fn(async () => null),
  createExport: vi.fn(async () => ({})),
  getExportById: vi.fn(async () => null),
}))

const adminDoc = {
  _id: 'admin-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  accountStatus: 'ACTIVE',
  isSuperAdmin: true,
  permissionList: ['*'],
  preferredLanguage: 'en' as const,
  dateCreated: 1700000000,
  lastUpdated: 1700000000,
}

vi.mock('@/server/repositories/admin-repo', () => ({
  findById: vi.fn(async () => adminDoc),
  listAdmins: vi.fn(async () => ({ items: [], total: 0 })),
  toAdminOut: vi.fn((doc: Record<string, unknown>) => doc),
}))

import { Hono } from 'hono'
import type { Env } from '@/server/core/http-env'
import { AppError } from '@/server/core/errors'
import { __resetSettingsCache } from '@/server/core/settings'
import { signAccessToken } from '@/server/security/jwt'
import { adminPermissionGuard, __resetAdminRouteCatalog } from '@/server/security/admin-permission-guard'
import { adminCore } from '@/server/routes/admin-core'
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
  app.route('/api/v1/admins', adminCore)
  return app
}

let app: ReturnType<typeof makeApp>
let auth: { Authorization: string }

beforeAll(async () => {
  __resetSettingsCache()
  __resetAdminRouteCatalog()
  app = makeApp()
  const token = await signAccessToken({
    sub: 'admin-1',
    role: 'admin',
    audience: 'admin-web',
    sessionId: 'sess-1',
  })
  auth = { Authorization: `Bearer ${token}` }
})

beforeEach(() => {
  listAlerts.mockClear()
  listAuditEvents.mockClear()
})

describe('GET /monitoring/alerts', () => {
  it('forwards status and unreadOnly alongside pagination', async () => {
    const res = await app.request(
      '/api/v1/admins/monitoring/alerts?status=open&unreadOnly=true&limit=10&skip=5',
      { headers: auth },
    )
    expect(res.status).toBe(200)
    expect(listAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open', unreadOnly: true, limit: 10, skip: 5 }),
    )
  })

  it('treats unreadOnly=false as false, not as a truthy string', async () => {
    const res = await app.request('/api/v1/admins/monitoring/alerts?unreadOnly=false', { headers: auth })
    expect(res.status).toBe(200)
    expect(listAlerts).toHaveBeenCalledWith(expect.objectContaining({ unreadOnly: false }))
  })

  it('rejects a status outside the supported set', async () => {
    // 422 is this router's declared validation-error status (see the shared `errs` map).
    const res = await app.request('/api/v1/admins/monitoring/alerts?status=bogus', { headers: auth })
    expect(res.status).toBe(422)
    expect(listAlerts).not.toHaveBeenCalled()
  })
})

describe('GET /monitoring/alerts/sla', () => {
  it('forwards the hours window and keeps the SLA narrowing', async () => {
    const res = await app.request('/api/v1/admins/monitoring/alerts/sla?hours=12', { headers: auth })
    expect(res.status).toBe(200)
    expect(listAlerts).toHaveBeenCalledWith(expect.objectContaining({ hours: 12, slaOnly: true }))
  })
})

describe('GET /monitoring/audit/history', () => {
  it('maps every snake_case filter onto its camelCase repo option', async () => {
    const res = await app.request(
      '/api/v1/admins/monitoring/audit/history?actor_id=admin-9&target_id=cust-3' +
        '&endpoint=%2Fapi%2Fv1%2Fadmins&event_type=PERMISSION_DENIED&status=failed' +
        '&severity=critical&from_epoch=1700000000&to_epoch=1700086400',
      { headers: auth },
    )
    expect(res.status).toBe(200)
    expect(listAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-9',
        targetId: 'cust-3',
        endpoint: '/api/v1/admins',
        eventType: 'PERMISSION_DENIED',
        status: 'failed',
        severity: 'critical',
        fromEpoch: 1700000000,
        toEpoch: 1700086400,
      }),
    )
  })

  it('splits a comma-joined tag list into an array', async () => {
    const res = await app.request('/api/v1/admins/monitoring/audit/history?tags=auth,admin', { headers: auth })
    expect(res.status).toBe(200)
    expect(listAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ tags: ['auth', 'admin'] }))
  })

  it('forwards sort and cursor', async () => {
    const res = await app.request(
      '/api/v1/admins/monitoring/audit/history?sort=asc&cursor=507f1f77bcf86cd799439011',
      { headers: auth },
    )
    expect(res.status).toBe(200)
    expect(listAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'asc', cursor: '507f1f77bcf86cd799439011' }),
    )
  })

  it('rejects a sort direction outside asc/desc', async () => {
    const res = await app.request('/api/v1/admins/monitoring/audit/history?sort=sideways', { headers: auth })
    expect(res.status).toBe(422)
    expect(listAuditEvents).not.toHaveBeenCalled()
  })

  it('still serves an unfiltered request', async () => {
    const res = await app.request('/api/v1/admins/monitoring/audit/history', { headers: auth })
    expect(res.status).toBe(200)
    expect(listAuditEvents).toHaveBeenCalledTimes(1)
  })
})
