import type { Collection, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import type { BroadcastDoc, BroadcastRecipient, BroadcastStatus } from '@/server/schemas/broadcast'
import { idFilter, toObjectId, fromDoc } from './_helpers'

/**
 * Data access for the `broadcasts` collection. Only this layer touches Mongo.
 *
 * The recipient list is stored ON the broadcast, frozen at dispatch. That is
 * what makes fan-out resumable and exactly-once-ish: a batch advances
 * `processedCount`, so a retry after a serverless timeout picks up where it
 * stopped instead of re-sending to everyone.
 */

let indexesReady = false

function collection(): Collection<BroadcastDoc> {
  return getDb().collection<BroadcastDoc>('broadcasts')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ status: 1, dateCreated: -1 }, { name: 'idx_broadcast_status' })
  indexesReady = true
}

export type BroadcastRow = BroadcastDoc & { id: string }

function toRow(doc: unknown): BroadcastRow {
  return fromDoc(doc) as unknown as BroadcastRow
}

export async function insert(doc: BroadcastDoc): Promise<BroadcastRow> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toRow(stored)
}

export async function getById(id: string): Promise<BroadcastRow | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toRow(row) : null
}

export async function update(id: string, set: Partial<BroadcastDoc>): Promise<BroadcastRow | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return getById(id)
}

/**
 * Record progress after a batch. Uses `$inc` so concurrent batch runs cannot
 * clobber each other's counts.
 */
export async function recordBatch(
  id: string,
  processed: number,
  sent: number,
  failed: number,
): Promise<BroadcastRow | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $inc: { processedCount: processed, sentCount: sent, failedCount: failed },
    $set: { lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return getById(id)
}

/**
 * Atomically claim a queued broadcast for sending, so two overlapping cron
 * invocations cannot both process the same one.
 */
export async function claimForSending(id: string): Promise<boolean> {
  await ensureIndexes()
  const result = await collection().updateOne(
    { ...idFilter(id), status: { $in: ['QUEUED', 'SENDING'] } } as Filter<BroadcastDoc>,
    { $set: { status: 'SENDING', lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return result.matchedCount > 0
}

/** Broadcasts still needing work — the cron worker's queue. */
export async function listPending(limit = 5): Promise<BroadcastRow[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ status: { $in: ['QUEUED', 'SENDING'] } })
    .sort({ dateCreated: 1 })
    .limit(limit)
    .toArray()
  return rows.map(toRow)
}

export interface BroadcastListResult {
  items: BroadcastRow[]
  nextCursor: string | null
  pageSize: number
}

/** Cursor-paginated history, newest first (same convention as everywhere else). */
export async function list(args: {
  status?: BroadcastStatus
  cursor?: string
  pageSize?: number
}): Promise<BroadcastListResult> {
  await ensureIndexes()
  const pageSize = args.pageSize && args.pageSize > 0 ? args.pageSize : 20

  const query: Filter<BroadcastDoc> & Record<string, unknown> = {}
  if (args.status) query.status = args.status
  if (args.cursor) query._id = { $lt: toObjectId(args.cursor) } as never

  const rows = await collection()
    .find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .toArray()

  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  return {
    items: page.map(toRow),
    nextCursor: hasMore ? String(page[page.length - 1]?._id) : null,
    pageSize,
  }
}

/** The slice of recipients a batch should process. */
export function batchOf(
  recipients: BroadcastRecipient[],
  processed: number,
  size: number,
): BroadcastRecipient[] {
  return recipients.slice(processed, processed + size)
}
