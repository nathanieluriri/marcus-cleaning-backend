import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import type { ApplicationDoc, ApplicationStatus } from '@/server/schemas/cleaner-application'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for `cleaner_applications`. One application per cleaner (unique
 * index), so the wizard's repeated PATCHes converge on a single draft.
 * Only this layer touches Mongo.
 */

let indexesReady = false

function collection(): Collection<ApplicationDoc> {
  return getDb().collection<ApplicationDoc>('cleaner_applications')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ cleanerId: 1 }, { name: 'uniq_application_cleaner', unique: true })
  await col.createIndex({ status: 1, submittedAt: 1 }, { name: 'idx_application_status' })
  indexesReady = true
}

/** Raw document + id, left unparsed so the service can enrich before validating. */
export type ApplicationRow = ApplicationDoc & { id: string }

function toRow(doc: unknown): ApplicationRow {
  return fromDoc(doc) as unknown as ApplicationRow
}

export async function findByCleanerId(cleanerId: string): Promise<ApplicationRow | null> {
  await ensureIndexes()
  const row = await collection().findOne({ cleanerId })
  return row ? toRow(row) : null
}

export async function findById(id: string): Promise<ApplicationRow | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toRow(row) : null
}

/** Create the draft if absent, then return the current row. */
export async function ensureDraft(doc: ApplicationDoc): Promise<ApplicationRow> {
  await ensureIndexes()
  await collection().updateOne({ cleanerId: doc.cleanerId }, { $setOnInsert: doc }, { upsert: true })
  const stored = await collection().findOne({ cleanerId: doc.cleanerId })
  return toRow(stored)
}

export async function update(id: string, set: Partial<ApplicationDoc>): Promise<ApplicationRow | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return findById(id)
}

/** Append a document reference, replacing any prior attachment of the same kind. */
export async function attachDocument(
  id: string,
  entry: ApplicationDoc['documents'][number],
): Promise<ApplicationRow | null> {
  await ensureIndexes()
  const now = Math.floor(Date.now() / 1000)
  // A cleaner re-uploading their ID replaces the old one rather than stacking.
  await collection().updateOne(idFilter(id), {
    $pull: { documents: { kind: entry.kind } },
    $set: { lastUpdated: now },
  } as never)
  await collection().updateOne(idFilter(id), {
    $push: { documents: entry },
    $set: { lastUpdated: now },
  } as never)
  return findById(id)
}

export interface ApplicationQueueResult {
  items: ApplicationRow[]
  total: number
}

/** Admin review queue, oldest submission first. */
export async function listByStatus(
  statuses: ApplicationStatus[],
  limit = 50,
  skip = 0,
): Promise<ApplicationQueueResult> {
  await ensureIndexes()
  const filter = { status: { $in: statuses } }
  const [rows, total] = await Promise.all([
    collection().find(filter).sort({ submittedAt: 1 }).skip(skip).limit(limit).toArray(),
    collection().countDocuments(filter),
  ])
  return { items: rows.map(toRow), total }
}
