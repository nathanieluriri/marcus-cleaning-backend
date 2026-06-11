import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { ReviewOut, type ReviewDoc, type ReviewOut as ReviewOutType } from '@/server/schemas/review'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `reviews` collection.
 * Ported from `repositories/review.py`. Only this layer touches Mongo.
 * See: docs/migration/06-services-and-repositories.md
 */

let indexesReady = false

function collection(): Collection<ReviewDoc> {
  return getDb().collection<ReviewDoc>('reviews')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ cleaner_id: 1 }, { name: 'idx_review_cleaner_id' })
  await collection().createIndex({ customer_id: 1 }, { name: 'idx_review_customer_id' })
  indexesReady = true
}

function toOut(doc: unknown): ReviewOutType {
  return ReviewOut.parse(fromDoc(doc))
}

export async function list(filter: { cleaner_id?: string } = {}): Promise<ReviewOutType[]> {
  await ensureIndexes()
  const query: Record<string, unknown> = {}
  if (filter.cleaner_id) query.cleaner_id = filter.cleaner_id
  const rows = await collection().find(query).sort({ dateCreated: -1 }).toArray()
  return rows.map(toOut)
}

export async function getById(id: string): Promise<ReviewOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toOut(row) : null
}

export async function insert(doc: ReviewDoc): Promise<ReviewOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function update(id: string, patch: Partial<ReviewDoc>): Promise<ReviewOutType | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), { $set: patch })
  const stored = await collection().findOne(idFilter(id))
  return stored ? toOut(stored) : null
}

export async function remove(id: string): Promise<boolean> {
  await ensureIndexes()
  const result = await collection().deleteOne(idFilter(id))
  return result.deletedCount > 0
}

/** Raw fetch used by the access guard (needs the author id). */
export async function findRawById(id: string): Promise<WithId<ReviewDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}
