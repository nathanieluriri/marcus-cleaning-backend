import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

/**
 * Invite-only admin creation (Task 5, admin platform plan). Repo/email are
 * mocked per the password-reset.test.ts / admin-otp-login.test.ts pattern —
 * service-level tests, no Mongo.
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
  accessPreset?: string | null
  mustChangePassword?: boolean
  tempPasswordExpiresAt?: number | null
  dateCreated: number
  lastUpdated: number
}

const adminsStore = new Map<string, AdminDocFixture>()
let nextId = 1

vi.mock('@/server/repositories/admin-repo', () => ({
  findByEmail: vi.fn(async (email: string) => [...adminsStore.values()].find((a) => a.email === email) ?? null),
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  insertAdmin: vi.fn(async (doc: Omit<AdminDocFixture, '_id'>) => {
    const id = `admin-${nextId++}`
    const stored: AdminDocFixture = { ...doc, _id: id }
    adminsStore.set(id, stored)
    return toAdminOutImpl(stored)
  }),
  updateAdmin: vi.fn(async (id: string, patch: Partial<AdminDocFixture>) => {
    const existing = adminsStore.get(id)
    if (!existing) return
    adminsStore.set(id, { ...existing, ...patch })
  }),
  toAdminOut: vi.fn((doc: AdminDocFixture) => toAdminOutImpl(doc)),
}))

function toAdminOutImpl(doc: AdminDocFixture) {
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
    totpEnabled: false,
    dateCreated: doc.dateCreated,
    lastUpdated: doc.lastUpdated,
  }
}

const sentInvites: { to: string; tempPassword: string; loginUrl: string }[] = []

vi.mock('@/server/core/email/send', () => ({
  sendAdminInviteEmail: vi.fn(async (args: { to: string; tempPassword: string; loginUrl: string }) => {
    sentInvites.push(args)
  }),
}))

import * as inviteService from '@/server/services/admin-invite-service'
import * as adminRepo from '@/server/repositories/admin-repo'
import { sendAdminInviteEmail } from '@/server/core/email/send'
import { verifyPassword } from '@/server/security/hash'
import { expandPreset } from '@/server/security/admin-presets'

beforeAll(() => {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.CORS_ORIGINS ??= 'https://admin.example.com'
  process.env.STORAGE_BACKEND ??= 'local'
  __resetSettingsCache()
})

beforeEach(() => {
  adminsStore.clear()
  sentInvites.length = 0
  nextId = 1
  vi.clearAllMocks()
})

describe('admin invites — invite()', () => {
  it('creates an admin with a hashed temp password, mustChangePassword, and expanded preset', async () => {
    const created = await inviteService.invite({
      email: 'New.Admin@Example.com',
      fullName: 'Jane Doe',
      accessPreset: 'support_only',
    })

    expect(created.mustChangePassword).toBe(true)
    expect(created.accessPreset).toBe('support_only')
    expect(created.email).toBe('new.admin@example.com')
    expect(created.permissionList).toEqual(expandPreset('support_only'))

    const stored = [...adminsStore.values()][0]
    expect(stored.firstName).toBe('Jane')
    expect(stored.lastName).toBe('Doe')
    expect(stored.tempPasswordExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(stored.password).not.toBe('') // hashed, not plaintext

    expect(sendAdminInviteEmail).toHaveBeenCalledTimes(1)
    const [emailArgs] = sentInvites
    expect(emailArgs.to).toBe('new.admin@example.com')
    expect(emailArgs.tempPassword).toHaveLength(12)
    expect(await verifyPassword(emailArgs.tempPassword, stored.password)).toBe(true)
  })

  it('falls back lastName to firstName when fullName has no space', async () => {
    await inviteService.invite({ email: 'solo@example.com', fullName: 'Cher', accessPreset: 'finance_only' })
    const stored = [...adminsStore.values()][0]
    expect(stored.firstName).toBe('Cher')
    expect(stored.lastName).toBe('Cher')
  })

  it('rejects invite for an email that already exists (409 EMAIL_EXISTS)', async () => {
    await inviteService.invite({ email: 'dupe@example.com', fullName: 'A B', accessPreset: 'support_only' })
    await expect(
      inviteService.invite({ email: 'dupe@example.com', fullName: 'C D', accessPreset: 'finance_only' }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'EMAIL_EXISTS' })
  })

  it('expands all_controls to the wildcard permission', async () => {
    const created = await inviteService.invite({
      email: 'super@example.com',
      fullName: 'Super Admin',
      accessPreset: 'all_controls',
    })
    expect(created.permissionList).toEqual(['*'])
  })
})

describe('admin invites — resend()', () => {
  it('regenerates the temp password and expiry, and re-emails when still pending activation', async () => {
    const created = await inviteService.invite({
      email: 'pending@example.com',
      fullName: 'Pending Admin',
      accessPreset: 'support_only',
    })
    const firstHash = ([...adminsStore.values()][0]).password
    vi.clearAllMocks()

    const updated = await inviteService.resend(created.id)

    expect(updated.mustChangePassword).toBe(true)
    const stored = adminsStore.get(created.id)!
    expect(stored.password).not.toBe(firstHash)
    expect(sendAdminInviteEmail).toHaveBeenCalledTimes(1)
    expect(sentInvites[0].to).toBe('pending@example.com')
  })

  it('rejects resend once the admin has activated (mustChangePassword false) with 409', async () => {
    const created = await inviteService.invite({
      email: 'activated@example.com',
      fullName: 'Activated Admin',
      accessPreset: 'support_only',
    })
    await adminRepo.updateAdmin(created.id, { mustChangePassword: false })
    vi.clearAllMocks()

    await expect(inviteService.resend(created.id)).rejects.toMatchObject({ httpStatus: 409 })
    expect(sendAdminInviteEmail).not.toHaveBeenCalled()
  })

  it('404s resend for an unknown admin id', async () => {
    await expect(inviteService.resend('nope')).rejects.toMatchObject({ httpStatus: 404 })
  })
})
