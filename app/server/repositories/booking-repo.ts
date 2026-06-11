import type { Collection, Filter, Sort } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  BookingOut,
  type BookingDoc,
  type BookingOut as BookingOutType,
  type BookingStatus,
  type BookingPaymentStatus,
  type BookingHistoryScope,
} from '@/server/schemas/booking'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `bookings` collection.
 * Ported from `repositories/booking_repo.py`. Only this layer touches Mongo.
 *
 * Indexes (per docs/migration/02-data-model.md): customer_id, cleaner_id,
 * status, schedule, place_id, and a unique sparse payment_id.
 */

let indexesReady = false

function collection(): Collection<BookingDoc> {
  return getDb().collection<BookingDoc>('bookings')
}

export async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ customer_id: 1 }, { name: 'idx_booking_customer_id' })
  await col.createIndex({ cleaner_id: 1 }, { name: 'idx_booking_cleaner_id' })
  await col.createIndex({ status: 1 }, { name: 'idx_booking_status' })
  await col.createIndex({ schedule: 1 }, { name: 'idx_booking_schedule' })
  await col.createIndex({ place_id: 1 }, { name: 'idx_booking_place_id' })
  await col.createIndex(
    { payment_id: 1 },
    { name: 'idx_booking_payment_id', unique: true, sparse: true },
  )
  indexesReady = true
}

function parse(doc: unknown): BookingOutType {
  return BookingOut.parse(fromDoc(doc))
}

export async function createBooking(doc: BookingDoc): Promise<BookingOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return parse(stored)
}

export async function getBookingById(id: string): Promise<BookingOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? parse(row) : null
}

export interface BookingFilter {
  customerId?: string
  cleanerId?: string
  status?: BookingStatus
  paymentStatus?: BookingPaymentStatus
}

function buildFilter(f: BookingFilter): Filter<BookingDoc> {
  const query: Filter<BookingDoc> = {}
  if (f.customerId) query.customer_id = f.customerId
  if (f.cleanerId) query.cleaner_id = f.cleanerId
  if (f.status) query.status = f.status
  if (f.paymentStatus) query.payment_status = f.paymentStatus
  return query
}

/** Simple filtered fetch (scheduled ascending), no pagination. */
export async function getBookings(f: BookingFilter): Promise<BookingOutType[]> {
  await ensureIndexes()
  const rows = await collection().find(buildFilter(f)).sort({ schedule: 1 }).toArray()
  return rows.map(parse)
}

export interface BookingHistoryQuery extends BookingFilter {
  scope?: BookingHistoryScope
  scheduledSort?: 'asc' | 'desc'
  /** Cursor = the `_id` of the last item from the previous page. */
  cursor?: string
  pageSize?: number
  /** Reference "now" (epoch seconds) for scope time filtering. */
  now?: number
}

export interface BookingHistoryResult {
  items: BookingOutType[]
  nextCursor: string | null
  pageSize: number
}

/**
 * Cursor/offset paginated history with scope time filtering and scheduled sort.
 * `scope` filters by `schedule` relative to `now` (upcoming = future, past =
 * already elapsed). Cursor pagination is `_id`-based and stable within a sort.
 */
export async function getBookingsHistory(q: BookingHistoryQuery): Promise<BookingHistoryResult> {
  await ensureIndexes()

  const pageSize = q.pageSize && q.pageSize > 0 ? q.pageSize : 20
  const sortDir = q.scheduledSort === 'asc' ? 1 : -1
  const now = q.now ?? Math.floor(Date.now() / 1000)

  const query = buildFilter(q) as Filter<BookingDoc> & Record<string, unknown>

  // Scope time filter on the scheduled epoch.
  if (q.scope === 'upcoming') query.schedule = { $gte: now }
  else if (q.scope === 'past') query.schedule = { $lt: now }

  // Cursor: continue after the last seen _id, honoring the sort direction.
  if (q.cursor) {
    const { toObjectId } = await import('./_helpers')
    const cursorOp = sortDir === 1 ? '$gt' : '$lt'
    query._id = { [cursorOp]: toObjectId(q.cursor) }
  }

  const sort: Sort = { schedule: sortDir, _id: sortDir }

  // Fetch one extra to detect whether a further page exists.
  const rows = await collection()
    .find(query)
    .sort(sort)
    .limit(pageSize + 1)
    .toArray()

  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  const nextCursor = hasMore ? String(page[page.length - 1]?._id) : null

  return { items: page.map(parse), nextCursor, pageSize }
}

export async function updateBooking(
  id: string,
  set: Partial<BookingDoc>,
): Promise<BookingOutType | null> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), { $set: set })
  return getBookingById(id)
}

/** Count bookings for a cleaner (optionally filtered by status). Derivation source for jobsDone. */
export async function countForCleaner(cleaner_id: string, status?: BookingStatus): Promise<number> {
  await ensureIndexes()
  const query: Filter<BookingDoc> = { cleaner_id }
  if (status) query.status = status
  return collection().countDocuments(query)
}

/**
 * Cleaner job feed: jobs assigned to this cleaner PLUS the unassigned PENDING
 * pool, excluding jobs this cleaner has declined. Scheduled ascending.
 */
export async function getCleanerJobFeed(cleanerId: string): Promise<BookingOutType[]> {
  await ensureIndexes()
  const query: Filter<BookingDoc> & Record<string, unknown> = {
    $or: [{ cleaner_id: cleanerId }, { cleaner_id: null, status: 'PENDING' }],
    declinedBy: { $ne: cleanerId },
  }
  const rows = await collection().find(query).sort({ schedule: 1 }).toArray()
  return rows.map(parse)
}

/** Record that a cleaner has passed on an (unassigned) job. */
export async function addDecline(bookingId: string, cleanerId: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(bookingId), {
    $addToSet: { declinedBy: cleanerId },
    $set: { lastUpdated: Math.floor(Date.now() / 1000) },
  })
}
