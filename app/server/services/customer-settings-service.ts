import { notFound } from '@/server/core/errors'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as customerExtrasRepo from '@/server/repositories/customer-extras-repo'
import type { CustomerOut } from '@/server/schemas/customer'

/**
 * Customer profile / settings / language / account-lifecycle business logic.
 * No HTTP types here (cron/tests can reuse).
 *
 * Reads go through `customer-repo` (owned elsewhere); mutations on the
 * `customers` collection go through `customer-extras-repo` (this slice's repo).
 *
 * See: docs/migration/07-domain-endpoints.md (`/v1/customers`).
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Default settings shape returned when a customer doc has no `settings` yet. */
const DEFAULT_SETTINGS = {
  notifications: { push: true, email: true, sms: false },
  security: { twoFactorEnabled: false },
  privacy: { profileVisible: true, shareUsageData: false },
} as const

export interface ProfileUpdate {
  firstName?: string
  lastName?: string
  phoneNumber?: string | null
  avatarDocumentId?: string | null
}

export async function getProfile(customerId: string): Promise<CustomerOut> {
  const raw = await customerRepo.findById(customerId)
  if (!raw) throw notFound('Customer not found')
  return customerRepo.toCustomerOut(raw)
}

export async function updateProfile(customerId: string, payload: ProfileUpdate): Promise<CustomerOut> {
  const patch: Record<string, unknown> = { lastUpdated: nowEpoch() }
  if (payload.firstName !== undefined) patch.firstName = payload.firstName
  if (payload.lastName !== undefined) patch.lastName = payload.lastName
  if (payload.phoneNumber !== undefined) patch.phoneNumber = payload.phoneNumber
  if (payload.avatarDocumentId !== undefined) patch.avatarDocumentId = payload.avatarDocumentId

  const updated = await customerExtrasRepo.updateProfile(customerId, patch)
  if (!updated) throw notFound('Customer not found')
  return updated
}

export async function getLanguage(customerId: string): Promise<{ language: 'en' | 'fr' }> {
  const language = await customerExtrasRepo.getPreferredLanguage(customerId)
  return { language }
}

export async function setLanguage(
  customerId: string,
  language: 'en' | 'fr',
): Promise<{ language: 'en' | 'fr' }> {
  const updated = await customerExtrasRepo.updatePreferredLanguage(customerId, language, nowEpoch())
  if (!updated) throw notFound('Customer not found')
  return { language: updated.preferredLanguage }
}

export async function getSettings(customerId: string): Promise<Record<string, unknown>> {
  const raw = await customerRepo.findById(customerId)
  if (!raw) throw notFound('Customer not found')
  const stored = await customerExtrasRepo.getSettings(customerId)
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
}

async function patchSettingsSection(
  customerId: string,
  section: 'notifications' | 'security' | 'privacy',
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = await customerRepo.findById(customerId)
  if (!raw) throw notFound('Customer not found')
  await customerExtrasRepo.updateSettings(customerId, section, patch, nowEpoch())
  return getSettings(customerId)
}

export function patchNotifications(customerId: string, patch: Record<string, unknown>) {
  return patchSettingsSection(customerId, 'notifications', patch)
}

export function patchSecurity(customerId: string, patch: Record<string, unknown>) {
  return patchSettingsSection(customerId, 'security', patch)
}

export function patchPrivacy(customerId: string, patch: Record<string, unknown>) {
  return patchSettingsSection(customerId, 'privacy', patch)
}

export async function deactivateAccount(customerId: string): Promise<CustomerOut> {
  const updated = await customerExtrasRepo.setAccountStatus(customerId, 'DEACTIVATED', nowEpoch())
  if (!updated) throw notFound('Customer not found')
  return updated
}

/** Soft-delete: mark the account DELETED (lifecycle). */
export async function deleteAccount(customerId: string): Promise<CustomerOut> {
  const updated = await customerExtrasRepo.setAccountStatus(customerId, 'DELETED', nowEpoch())
  if (!updated) throw notFound('Customer not found')
  return updated
}
