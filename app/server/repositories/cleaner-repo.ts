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
  await collection().createIndex({ onboardingStatus: 1 }, { name: 'idx_cleaner_onboarding_status' })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<CleanerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

export async function findById(id: string): Promise<WithId<CleanerDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
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
