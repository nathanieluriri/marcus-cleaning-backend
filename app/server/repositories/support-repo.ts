import type { Collection, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  SupportTicketOut,
  type SupportTicketDoc,
  type SupportTicketOut as SupportTicketOutType,
  type TicketStatus,
} from '@/server/schemas/support'
import { idFilter, toObjectId, fromDoc } from './_helpers'

/**
 * Data access for `support_tickets` and `faq_entries`. Only this layer touches Mongo.
 */

let indexesReady = false

function tickets(): Collection<SupportTicketDoc> {
  return getDb().collection<SupportTicketDoc>('support_tickets')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = tickets()
  await col.createIndex({ reference: 1 }, { name: 'uniq_ticket_reference', unique: true })
  await col.createIndex({ requesterId: 1, dateCreated: -1 }, { name: 'idx_ticket_requester' })
  await col.createIndex({ status: 1, dateCreated: -1 }, { name: 'idx_ticket_status' })
  indexesReady = true
}

function toOut(doc: unknown): SupportTicketOutType {
  return SupportTicketOut.parse(fromDoc(doc))
}

export async function insert(doc: SupportTicketDoc): Promise<SupportTicketOutType> {
  await ensureIndexes()
  const result = await tickets().insertOne(doc)
  const stored = await tickets().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function getById(id: string): Promise<SupportTicketOutType | null> {
  await ensureIndexes()
  const row = await tickets().findOne(idFilter(id))
  return row ? toOut(row) : null
}

export interface TicketListResult {
  items: SupportTicketOutType[]
  nextCursor: string | null
  pageSize: number
}

/** Cursor-paginated, newest first (same convention as bookings and payouts). */
export async function listForRequester(args: {
  requesterId: string
  cursor?: string
  pageSize?: number
  status?: TicketStatus
}): Promise<TicketListResult> {
  await ensureIndexes()
  const pageSize = args.pageSize && args.pageSize > 0 ? args.pageSize : 20

  const query: Filter<SupportTicketDoc> & Record<string, unknown> = { requesterId: args.requesterId }
  if (args.status) query.status = args.status
  if (args.cursor) query._id = { $lt: toObjectId(args.cursor) } as never

  const rows = await tickets()
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

export async function update(
  id: string,
  set: Partial<SupportTicketDoc>,
): Promise<SupportTicketOutType | null> {
  await ensureIndexes()
  await tickets().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return getById(id)
}

/** True if the reference is already taken (reference generation retries on clash). */
export async function referenceExists(reference: string): Promise<boolean> {
  await ensureIndexes()
  return (await tickets().countDocuments({ reference }, { limit: 1 })) > 0
}
