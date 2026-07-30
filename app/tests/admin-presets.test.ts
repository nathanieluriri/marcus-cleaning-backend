import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Task 6: access presets + permission templates. Service-level tests —
 * admin-repo and role-permission-template-repo are mocked (password-reset /
 * admin-invites pattern), no Mongo.
 */

interface AdminDocFixture {
  _id: string
  isSuperAdmin: boolean
  permissionList: string[]
  accessPreset?: string | null
}

const adminsStore = new Map<string, AdminDocFixture>()

function seedAdmin(doc: AdminDocFixture) {
  adminsStore.set(doc._id, doc)
}

function toAdminOutImpl(doc: AdminDocFixture) {
  return {
    id: doc._id,
    isSuperAdmin: doc.isSuperAdmin,
    permissionList: doc.permissionList,
    accessPreset: doc.accessPreset ?? null,
    totpEnabled: false,
  }
}

vi.mock('@/server/repositories/admin-repo', () => ({
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  updateAdmin: vi.fn(async (id: string, patch: Partial<AdminDocFixture>) => {
    const existing = adminsStore.get(id)
    if (!existing) return
    adminsStore.set(id, { ...existing, ...patch })
  }),
  countAdminsWithStar: vi.fn(async () =>
    [...adminsStore.values()].filter((a) => a.isSuperAdmin || a.permissionList.includes('*')).length,
  ),
  listByAccessPreset: vi.fn(async (preset: string) => [...adminsStore.values()].filter((a) => a.accessPreset === preset)),
  countByAccessPreset: vi.fn(async (preset: string) => [...adminsStore.values()].filter((a) => a.accessPreset === preset).length),
  toAdminOut: vi.fn((doc: AdminDocFixture) => toAdminOutImpl(doc)),
}))

const templateStore = new Map<string, Record<string, unknown>>()

vi.mock('@/server/repositories/role-permission-template-repo', () => ({
  getByRole: vi.fn(async (role: string) => templateStore.get(role) ?? null),
  upsertForRole: vi.fn(async (role: string, data: Record<string, unknown>) => {
    const stored = { ...data, role, lastUpdated: 1 }
    templateStore.set(role, stored)
    return stored
  }),
  markRollout: vi.fn(async (role: string, meta: Record<string, unknown>) => {
    const existing = templateStore.get(role) ?? { role }
    const updated = { ...existing, lastRollout: { ...meta, at: 1 } }
    templateStore.set(role, updated)
    return updated
  }),
}))

import * as mgmt from '@/server/services/admin-management-service'
import * as templates from '@/server/services/role-permission-template-service'
import * as adminRepo from '@/server/repositories/admin-repo'
import { expandPreset } from '@/server/security/admin-presets'

beforeEach(() => {
  adminsStore.clear()
  templateStore.clear()
  vi.clearAllMocks()
})

describe('access presets — catalog', () => {
  it('lists every named preset with a permission count', () => {
    const { items } = { items: mgmt.listAccessPresets() }
    const keys = items.map((i) => i.key)
    expect(keys).toContain('operations_only')
    expect(keys).toContain('all_controls')
    const ops = items.find((i) => i.key === 'operations_only')!
    expect(ops.permissionCount).toBe(expandPreset('operations_only').length)
  })
})

describe('setAccessPreset', () => {
  it('sets the preset and expands permissionList for the target', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'target-1', isSuperAdmin: false, permissionList: [], accessPreset: null })

    const result = await mgmt.setAccessPreset({ callerId: 'super-1', targetId: 'target-1', preset: 'support_only' })

    expect(result.accessPreset).toBe('support_only')
    expect(result.permissionList).toEqual(expandPreset('support_only'))
  })

  it('rejects unknown preset keys', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'target-1', isSuperAdmin: false, permissionList: [], accessPreset: null })

    await expect(mgmt.setAccessPreset({ callerId: 'super-1', targetId: 'target-1', preset: 'nope' })).rejects.toMatchObject({
      httpStatus: 404,
    })
  })

  it('rejects target that does not exist', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })

    await expect(
      mgmt.setAccessPreset({ callerId: 'super-1', targetId: 'ghost', preset: 'support_only' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('refuses a non-super caller changing another admin preset', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'regular-1', isSuperAdmin: false, permissionList: [], accessPreset: 'support_only' })
    seedAdmin({ _id: 'target-1', isSuperAdmin: false, permissionList: [], accessPreset: null })

    await expect(
      mgmt.setAccessPreset({ callerId: 'regular-1', targetId: 'target-1', preset: 'support_only' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('allows a non-super caller changing their own non-super preset', async () => {
    seedAdmin({ _id: 'regular-1', isSuperAdmin: false, permissionList: expandPreset('support_only'), accessPreset: 'support_only' })

    const result = await mgmt.setAccessPreset({ callerId: 'regular-1', targetId: 'regular-1', preset: 'operations_only' })
    expect(result.accessPreset).toBe('operations_only')
  })

  it('refuses a non-super caller granting themselves all_controls', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'regular-1', isSuperAdmin: false, permissionList: [], accessPreset: 'support_only' })

    await expect(
      mgmt.setAccessPreset({ callerId: 'regular-1', targetId: 'regular-1', preset: 'all_controls' }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('last-star protection: cannot change the preset of the last admin with full access', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })

    await expect(
      mgmt.setAccessPreset({ callerId: 'super-1', targetId: 'super-1', preset: 'support_only' }),
    ).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('allows changing a star holder preset when another star holder remains', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'super-2', isSuperAdmin: false, permissionList: ['*'], accessPreset: 'all_controls' })

    const result = await mgmt.setAccessPreset({ callerId: 'super-1', targetId: 'super-2', preset: 'finance_only' })
    expect(result.accessPreset).toBe('finance_only')

    const starCount = await adminRepo.countAdminsWithStar()
    expect(starCount).toBe(1)
  })
})

describe('bulkSetAccessPreset', () => {
  it('returns updated count and per-id skip reasons', async () => {
    seedAdmin({ _id: 'super-1', isSuperAdmin: true, permissionList: ['*'], accessPreset: 'all_controls' })
    seedAdmin({ _id: 'ok-1', isSuperAdmin: false, permissionList: [], accessPreset: null })
    seedAdmin({ _id: 'ok-2', isSuperAdmin: false, permissionList: [], accessPreset: null })

    const result = await mgmt.bulkSetAccessPreset({
      callerId: 'super-1',
      adminIds: ['ok-1', 'ok-2', 'missing-1'],
      preset: 'support_only',
    })

    expect(result.updated).toBe(2)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ id: 'missing-1' })
    expect(result.skipped[0].reason).toEqual(expect.any(String))
  })
})

describe('role-permission-template-service', () => {
  it('getTemplate returns the preset default when no override is stored', async () => {
    const tpl = await templates.getTemplate('support_only')
    expect(tpl.permissions).toEqual(expandPreset('support_only'))
  })

  it('getTemplate merges a stored override over the preset default', async () => {
    templateStore.set('support_only', { permissions: ['GET:/api/v1/support'], role: 'support_only' })
    const tpl = await templates.getTemplate('support_only')
    expect(tpl.permissions).toEqual(['GET:/api/v1/support'])
  })

  it('getTemplate 404s for an unknown role', async () => {
    await expect(templates.getTemplate('nope')).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('preview diffs current vs proposed permissions', async () => {
    templateStore.set('support_only', { permissions: ['A', 'B'], role: 'support_only' })
    const result = await templates.preview({ role: 'support_only', payload: { permissions: ['B', 'C'] } })
    expect(result.added).toEqual(['C'])
    expect(result.removed).toEqual(['A'])
  })

  it('rollout applies the template permissions to every admin on that preset', async () => {
    seedAdmin({ _id: 'a1', isSuperAdmin: false, permissionList: [], accessPreset: 'support_only' })
    seedAdmin({ _id: 'a2', isSuperAdmin: false, permissionList: [], accessPreset: 'support_only' })
    seedAdmin({ _id: 'a3', isSuperAdmin: false, permissionList: [], accessPreset: 'operations_only' })
    templateStore.set('support_only', { permissions: ['X', 'Y'], role: 'support_only' })

    const result = await templates.rollout({ role: 'support_only', triggeredBy: 'super-1' })

    expect(adminsStore.get('a1')?.permissionList).toEqual(['X', 'Y'])
    expect(adminsStore.get('a2')?.permissionList).toEqual(['X', 'Y'])
    expect(adminsStore.get('a3')?.permissionList).toEqual([])
    expect((result.lastRollout as Record<string, unknown>).applied).toBe(2)
  })

  it('rolloutImpact counts admins currently on that preset', async () => {
    seedAdmin({ _id: 'a1', isSuperAdmin: false, permissionList: [], accessPreset: 'finance_only' })
    seedAdmin({ _id: 'a2', isSuperAdmin: false, permissionList: [], accessPreset: 'finance_only' })
    seedAdmin({ _id: 'a3', isSuperAdmin: false, permissionList: [], accessPreset: 'support_only' })

    const impact = await templates.rolloutImpact('finance_only')
    expect(impact.affectedAdmins).toBe(2)
    expect(impact.permissionCount).toBe(expandPreset('finance_only').length)
  })
})
