import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { CleanerOut, type CleanerDoc, type CleanerOut as CleanerOutType } from '@/server/schemas/cleaner'
import { idFilter, fromDoc } from './_helpers'

/** Data access for the `cleaners` collection. Ported from `repositories/cleaner_repo.py`. */

let indexesReady = false

function collection(): Collection<CleanerDoc> {
  return getDb().collection<CleanerDoc>('cleaners')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ email: 1 }, { name: 'idx_cleaner_email', unique: true })
  await collection().createIndex(
    { authProvider: 1, authSubject: 1 },
    { name: 'idx_cleaner_auth_subject', sparse: true },
  )
  await collection().createIndex({ onboardingStatus: 1 }, { name: 'idx_cleaner_onboarding_status' })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<CleanerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

/**
 * Look up an account by the identity-provider subject it was linked with.
 *
 * This is the SAFE key for social sign-in: the subject is issued by the
 * provider and cannot be claimed by another user, whereas an email in an
 * unverified token can be set to anything.
 */
export async function findByAuthSubject(
  authProvider: string,
  authSubject: string,
): Promise<WithId<CleanerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ authProvider, authSubject })
}

export async function findById(id: string): Promise<WithId<CleanerDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

/** Ids of ACTIVE cleaners, optionally narrowed by onboarding status. */
export async function listActiveIds(onboardingStatus?: string): Promise<string[]> {
  await ensureIndexes()
  const filter: Record<string, unknown> = { accountStatus: 'ACTIVE' }
  if (onboardingStatus) filter.onboardingStatus = onboardingStatus
  const rows = await collection().find(filter, { projection: { _id: 1 } }).toArray()
  return rows.map((r) => String(r._id))
}

/**
 * Ids that have explicitly turned marketing notifications OFF.
 *
 * Only an explicit `false` counts — an account that has never touched the
 * setting is opted IN, matching the documented default.
 */
export async function listMarketingOptOutIds(): Promise<string[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ 'settings.notifications.marketing': false }, { projection: { _id: 1 } })
    .toArray()
  return rows.map((r) => String(r._id))
}

export async function insertCleaner(doc: CleanerDoc): Promise<CleanerOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return CleanerOut.parse(fromDoc(stored))
}

export async function updateCleaner(id: string, patch: Partial<CleanerDoc>): Promise<CleanerOutType | null> {
  await collection().updateOne(idFilter(id), { $set: { ...patch, lastUpdated: Math.floor(Date.now() / 1000) } })
  const stored = await collection().findOne(idFilter(id))
  return stored ? CleanerOut.parse(fromDoc(stored)) : null
}

export async function updateLastAuthAt(id: string, epochSeconds: number): Promise<void> {
  await collection().updateOne(idFilter(id), { $set: { lastAuthAt: epochSeconds, lastUpdated: epochSeconds } })
}

export function toCleanerOut(doc: unknown): CleanerOutType {
  return CleanerOut.parse(fromDoc(doc))
}

/** All ACTIVE, APPROVED cleaners (directory source). Raw docs for downstream enrichment. */
export async function listApproved(): Promise<WithId<CleanerDoc>[]> {
  await ensureIndexes()
  return collection()
    .find({ onboardingStatus: 'APPROVED', accountStatus: 'ACTIVE' })
    .sort({ dateCreated: -1 })
    .toArray()
}
