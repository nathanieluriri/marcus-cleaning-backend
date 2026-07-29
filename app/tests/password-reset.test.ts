import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Password reset (spec §5.1.1), generalised across customer/cleaner roles.
 * Repos, the reset-token store, sessions and email are mocked — this is a
 * service-level test of the role-scoping logic, not an integration test
 * against Mongo (no other test in this repo stands up a real/mocked Mongo).
 */

const resetStore = new Map<string, { accountId: string; role: string; expiresAt: Date }>()

vi.mock('@/server/repositories/password-reset-repo', () => ({
  issue: vi.fn(async (args: { accountId: string; role: string; token: string; expiresAt: Date }) => {
    resetStore.set(args.token, { accountId: args.accountId, role: args.role, expiresAt: args.expiresAt })
  }),
  consume: vi.fn(async (token: string, role: string) => {
    const entry = resetStore.get(token)
    if (!entry) return null
    if (entry.role !== role) return null
    if (entry.expiresAt.getTime() < Date.now()) return null
    resetStore.delete(token)
    return entry.accountId
  }),
}))

const seededCleaner = { _id: 'cleaner-1', email: 'cleaner@example.com' }
const seededCustomer = { _id: 'customer-1', email: 'customer@example.com' }

vi.mock('@/server/repositories/cleaner-repo', () => ({
  findByEmail: vi.fn(async (email: string) => (email === seededCleaner.email ? seededCleaner : null)),
  updatePassword: vi.fn(async () => {}),
}))

vi.mock('@/server/repositories/customer-repo', () => ({
  findByEmail: vi.fn(async (email: string) => (email === seededCustomer.email ? seededCustomer : null)),
  updatePassword: vi.fn(async () => {}),
}))

vi.mock('@/server/services/auth-session-service', () => ({
  revokeAllSessions: vi.fn(async () => 0),
}))

vi.mock('@/server/core/email/send', () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

import * as passwordResetService from '@/server/services/password-reset-service'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as sessions from '@/server/services/auth-session-service'
import { sendPasswordResetEmail } from '@/server/core/email/send'

function buildUrl(token: string) {
  return `https://app.example.com/reset-password?token=${token}`
}

beforeEach(() => {
  resetStore.clear()
  vi.clearAllMocks()
})

describe('password reset — cleaner role', () => {
  it('requests a reset for a seeded cleaner and emails the link', async () => {
    await passwordResetService.requestReset('cleaner', seededCleaner.email, buildUrl)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: seededCleaner.email }),
    )
    expect(resetStore.size).toBe(1)
  })

  it('stays silent (no email, no throw) for an unknown cleaner email', async () => {
    await expect(
      passwordResetService.requestReset('cleaner', 'nobody@example.com', buildUrl),
    ).resolves.toBeUndefined()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('confirms with the issued token, updates the password, and revokes sessions', async () => {
    await passwordResetService.requestReset('cleaner', seededCleaner.email, buildUrl)
    const token = [...resetStore.keys()][0]

    await passwordResetService.confirmReset('cleaner', token, 'new-super-secret')

    expect(cleanerRepo.updatePassword).toHaveBeenCalledWith(seededCleaner._id, expect.any(String))
    expect(sessions.revokeAllSessions).toHaveBeenCalledWith(seededCleaner._id)
    expect(resetStore.size).toBe(0)
  })

  it('rejects confirming with an invalid or already-consumed token', async () => {
    await expect(passwordResetService.confirmReset('cleaner', 'bogus-token', 'new-super-secret')).rejects.toThrow(
      /invalid or expired/i,
    )
  })

  it('REFUSES a customer reset token when confirming as a cleaner (role scoping)', async () => {
    await passwordResetService.requestReset('customer', seededCustomer.email, buildUrl)
    const token = [...resetStore.keys()][0]

    await expect(passwordResetService.confirmReset('cleaner', token, 'new-super-secret')).rejects.toThrow(
      /invalid or expired/i,
    )
    expect(cleanerRepo.updatePassword).not.toHaveBeenCalled()

    // The token is still valid for its actual role (customer) — proves the
    // rejection above was a role mismatch, not token corruption.
    await passwordResetService.confirmReset('customer', token, 'new-super-secret')
    expect(customerRepo.updatePassword).toHaveBeenCalledWith(seededCustomer._id, expect.any(String))
  })
})
