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

/** Average rating + count for a cleaner (derivation source for ratings). */
export async function aggregateForCleaner(cleaner_id: string): Promise<{ average: number; count: number }> {
  await ensureIndexes()
  const rows = await collection()
    .aggregate<{ average: number; count: number }>([
      { $match: { cleaner_id } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      { $project: { _id: 0, average: { $round: [{ $ifNull: ['$average', 0] }, 1] }, count: 1 } },
    ])
    .toArray()
  return rows[0] ?? { average: 0, count: 0 }
}

export interface CleanerReviewPage {
  items: ReviewOutType[]
  nextCursor: string | null
}

/** Cursor-paginated reviews for a cleaner, newest first, with optional star + since filters. */
export async function listForCleanerPaginated(args: {
  cleaner_id: string
  stars?: number
  since?: number
  cursor?: string
  pageSize?: number
}): Promise<CleanerReviewPage> {
  await ensureIndexes()
  const pageSize = args.pageSize && args.pageSize > 0 ? args.pageSize : 10
  const query: Record<string, unknown> = { cleaner_id: args.cleaner_id }
  if (args.stars) query.rating = args.stars
  if (args.since !== undefined) query.dateCreated = { $gte: args.since }
  if (args.cursor) {
    const { toObjectId } = await import('./_helpers')
    query._id = { $lt: toObjectId(args.cursor) }
  }
  const rows = await collection()
    .find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .toArray()
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  const nextCursor = hasMore ? String(page[page.length - 1]?._id) : null
  return { items: page.map(toOut), nextCursor }
}
