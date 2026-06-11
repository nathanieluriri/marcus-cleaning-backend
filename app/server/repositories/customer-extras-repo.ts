import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { CustomerOut, type CustomerDoc, type CustomerOut as CustomerOutType } from '@/server/schemas/customer'
import { idFilter, fromDoc } from './_helpers'

/**
 * Extra update operations on the `customers` collection that are NOT owned by
 * `customer-repo.ts` (which handles auth/profile reads + inserts). This repo
 * holds the profile/language/settings/account-lifecycle mutations used by the
 * customer-extras routes. Same collection (`customers`), distinct operations.
 *
 * See: docs/migration/07-domain-endpoints.md (`/v1/customers`).
 */

function collection(): Collection<CustomerDoc> {
  return getDb().collection<CustomerDoc>('customers')
}

function toOut(doc: unknown): CustomerOutType {
  return CustomerOut.parse(fromDoc(doc))
}

async function findRaw(id: string): Promise<WithId<CustomerDoc> | null> {
  return collection().findOne(idFilter(id))
}

/** Patch arbitrary profile fields (first/last name, phone, avatar, etc.). */
export async function updateProfile(
  id: string,
  patch: Partial<CustomerDoc>,
): Promise<CustomerOutType | null> {
  await collection().updateOne(idFilter(id), { $set: patch })
  const updated = await findRaw(id)
  return updated ? toOut(updated) : null
}

export async function updatePreferredLanguage(
  id: string,
  language: 'en' | 'fr',
  at: number,
): Promise<CustomerOutType | null> {
  await collection().updateOne(idFilter(id), { $set: { preferredLanguage: language, lastUpdated: at } })
  const updated = await findRaw(id)
  return updated ? toOut(updated) : null
}

/** Get the customer's preferred language (defaults to 'en'). */
export async function getPreferredLanguage(id: string): Promise<'en' | 'fr'> {
  const doc = await findRaw(id)
  return (doc?.preferredLanguage as 'en' | 'fr') ?? 'en'
}

/**
 * Read the embedded `settings` object (notifications/security/privacy prefs).
 * Stored as a sub-document on the customer; absent on legacy docs.
 */
export async function getSettings(id: string): Promise<Record<string, unknown> | null> {
  const doc = (await collection().findOne(idFilter(id), {
    projection: { settings: 1 },
  })) as (WithId<CustomerDoc> & { settings?: Record<string, unknown> }) | null
  return doc?.settings ?? null
}

/**
 * Deep-merge a partial settings sub-document under a named section
 * (`notifications` | `security` | `privacy`) using dotted `$set` keys so
 * sibling sections are preserved.
 */
export async function updateSettings(
  id: string,
  section: 'notifications' | 'security' | 'privacy',
  patch: Record<string, unknown>,
  at: number,
): Promise<Record<string, unknown> | null> {
  const set: Record<string, unknown> = { lastUpdated: at }
  for (const [k, v] of Object.entries(patch)) {
    set[`settings.${section}.${k}`] = v
  }
  await collection().updateOne(idFilter(id), { $set: set })
  return getSettings(id)
}

/** Set the customer's accountStatus (deactivate / soft-delete). */
export async function setAccountStatus(
  id: string,
  status: CustomerDoc['accountStatus'],
  at: number,
): Promise<CustomerOutType | null> {
  await collection().updateOne(idFilter(id), { $set: { accountStatus: status, lastUpdated: at } })
  const updated = await findRaw(id)
  return updated ? toOut(updated) : null
}
