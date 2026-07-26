import type { Collection, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { PayoutOut, type PayoutDoc, type PayoutOut as PayoutOutType, type PayoutStatus } from '@/server/schemas/earnings'
import { idFilter, toObjectId, fromDoc } from './_helpers'

/**
 * Data access for the `payouts` collection. Only this layer touches Mongo.
 */

let indexesReady = false

function collection(): Collection<PayoutDoc> {
  return getDb().collection<PayoutDoc>('payouts')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ cleanerId: 1, dateCreated: -1 }, { name: 'idx_payout_cleaner' })
  await col.createIndex({ status: 1 }, { name: 'idx_payout_status' })
  indexesReady = true
}

function toOut(doc: unknown): PayoutOutType {
  return PayoutOut.parse(fromDoc(doc))
}

export async function insert(doc: PayoutDoc): Promise<PayoutOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function getById(id: string): Promise<PayoutOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toOut(row) : null
}

export interface PayoutListResult {
  items: PayoutOutType[]
  nextCursor: string | null
  pageSize: number
}

/** Cursor-paginated history, newest first (matches the bookings convention). */
export async function listForCleaner(args: {
  cleanerId: string
  cursor?: string
  pageSize?: number
  status?: PayoutStatus
}): Promise<PayoutListResult> {
  await ensureIndexes()
  const pageSize = args.pageSize && args.pageSize > 0 ? args.pageSize : 20

  const query: Filter<PayoutDoc> & Record<string, unknown> = { cleanerId: args.cleanerId }
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
    items: page.map(toOut),
    nextCursor: hasMore ? String(page[page.length - 1]?._id) : null,
    pageSize,
  }
}

export async function update(id: string, set: Partial<PayoutDoc>): Promise<PayoutOutType | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return getById(id)
}

/** Total of payouts in the given statuses — the basis for the available balance. */
export async function sumByStatus(cleanerId: string, statuses: PayoutStatus[]): Promise<number> {
  await ensureIndexes()
  const rows = await collection()
    .aggregate([
      { $match: { cleanerId, status: { $in: statuses } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    .toArray()
  return rows.length > 0 ? Number(rows[0].total ?? 0) : 0
}

/** Payouts awaiting settlement — the cron reconciler's work list. */
export async function listUnsettled(limit = 50): Promise<PayoutOutType[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ status: { $in: ['PENDING', 'PROCESSING'] } })
    .sort({ dateCreated: 1 })
    .limit(limit)
    .toArray()
  return rows.map(toOut)
}
