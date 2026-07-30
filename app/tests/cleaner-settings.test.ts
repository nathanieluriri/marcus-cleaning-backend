import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Cleaner notification settings (Task 5). Mirrors customer-settings-service
 * conventions: defaults + shallow merge, dotted `settings.notifications.*`
 * storage so `cleanerRepo.listMarketingOptOutIds` keeps working unchanged.
 * Repo is mocked — this is a service-level test (see password-reset.test.ts).
 */

type SettingsStore = Record<string, Record<string, unknown>>

const store: SettingsStore = {}

vi.mock('@/server/repositories/cleaner-repo', () => ({
  findById: vi.fn(async (id: string) => ({ _id: id, email: 'cleaner@example.com' })),
  getSettings: vi.fn(async (id: string) => store[id] ?? null),
  updateSettingsSection: vi.fn(
    async (id: string, section: 'notifications', patch: Record<string, unknown>) => {
      const current = store[id] ?? {}
      const currentSection = (current[section] as Record<string, unknown>) ?? {}
      store[id] = { ...current, [section]: { ...currentSection, ...patch } }
      return store[id]
    },
  ),
}))

import * as cleanerSettingsService from '@/server/services/cleaner-settings-service'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'

const cleanerId = 'cleaner-1'

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.clearAllMocks()
})

describe('cleaner settings — notifications', () => {
  it('returns defaults when unset', async () => {
    const settings = await cleanerSettingsService.getSettings(cleanerId)
    expect(settings).toEqual({
      notifications: { push: true, email: true, sms: false, marketing: true },
    })
  })

  it('PATCH marketing: false then GET shows marketing false with other defaults intact', async () => {
    await cleanerSettingsService.patchNotifications(cleanerId, { marketing: false })
    const settings = await cleanerSettingsService.getSettings(cleanerId)
    expect(settings).toEqual({
      notifications: { push: true, email: true, sms: false, marketing: false },
    })
  })

  it('PATCH only touches provided keys', async () => {
    await cleanerSettingsService.patchNotifications(cleanerId, { push: false })
    await cleanerSettingsService.patchNotifications(cleanerId, { marketing: false })
    const settings = await cleanerSettingsService.getSettings(cleanerId)
    expect(settings).toEqual({
      notifications: { push: false, email: true, sms: false, marketing: false },
    })
  })

  it('calls updateSettingsSection with dotted-key-friendly section/patch args', async () => {
    await cleanerSettingsService.patchNotifications(cleanerId, { sms: true })
    expect(cleanerRepo.updateSettingsSection).toHaveBeenCalledWith(
      cleanerId,
      'notifications',
      { sms: true },
    )
  })

  it('throws not found for an unknown cleaner', async () => {
    ;(cleanerRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    await expect(cleanerSettingsService.getSettings('missing')).rejects.toThrow(/not found/i)
  })
})
