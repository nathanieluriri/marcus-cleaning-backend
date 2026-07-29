import { notFound } from '@/server/core/errors'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'

/**
 * Cleaner settings business logic. No HTTP types here (cron/tests can reuse).
 *
 * Mirrors `customer-settings-service.ts`: defaults + shallow merge, but only
 * the `notifications` section exists for cleaners today. Storage goes through
 * `cleaner-repo` using dotted `settings.notifications.*` keys so
 * `cleanerRepo.listMarketingOptOutIds` (`'settings.notifications.marketing': false`)
 * keeps working unchanged.
 */

/** Default settings shape returned when a cleaner doc has no `settings` yet. */
const DEFAULT_SETTINGS = {
  // `marketing` gates promotional broadcasts only. Transactional notifications
  // (jobs, bookings, payouts, chat, safety) ignore it.
  notifications: { push: true, email: true, sms: false, marketing: true },
} as const

export async function getSettings(cleanerId: string): Promise<Record<string, unknown>> {
  const raw = await cleanerRepo.findById(cleanerId)
  if (!raw) throw notFound('Cleaner not found')
  const stored = await cleanerRepo.getSettings(cleanerId)
  const storedNotifications = (stored?.notifications as Record<string, unknown>) ?? {}
  return {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...storedNotifications },
  }
}

export async function patchNotifications(
  cleanerId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = await cleanerRepo.findById(cleanerId)
  if (!raw) throw notFound('Cleaner not found')
  await cleanerRepo.updateSettingsSection(cleanerId, 'notifications', patch)
  return getSettings(cleanerId)
}
