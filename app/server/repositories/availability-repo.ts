import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { AvailabilityOut, type AvailabilityDoc, type AvailabilityOut as AvailabilityOutType } from '@/server/schemas/availability'
import { fromDoc } from './_helpers'

/**
 * Data access for `cleaner_availability` — one document per cleaner.
 * Only this layer touches Mongo.
 */

let indexesReady = false

function collection(): Collection<AvailabilityDoc> {
  return getDb().collection<AvailabilityDoc>('cleaner_availability')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ cleanerId: 1 }, { name: 'uniq_availability_cleaner', unique: true })
  indexesReady = true
}

function toOut(doc: unknown): AvailabilityOutType {
  return AvailabilityOut.parse(fromDoc(doc))
}

/** Read the cleaner's availability, creating the default document on first access. */
export async function getOrCreate(doc: AvailabilityDoc): Promise<AvailabilityOutType> {
  await ensureIndexes()
  await collection().updateOne({ cleanerId: doc.cleanerId }, { $setOnInsert: doc }, { upsert: true })
  const stored = await collection().findOne({ cleanerId: doc.cleanerId })
  return toOut(stored)
}

export async function find(cleanerId: string): Promise<AvailabilityOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne({ cleanerId })
  return row ? toOut(row) : null
}

export async function update(
  cleanerId: string,
  set: Partial<AvailabilityDoc>,
): Promise<AvailabilityOutType | null> {
  await ensureIndexes()
  await collection().updateOne(
    { cleanerId },
    { $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return find(cleanerId)
}
