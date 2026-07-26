import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  NotificationOut,
  type NotificationDoc,
  type NotificationOut as NotificationOutType,
} from '@/server/schemas/notification'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `notifications` collection.
 * Ported from `repositories/notifications.py`. Only this layer touches Mongo.
 * See: docs/migration/06-services-and-repositories.md
 */

let indexesReady = false

function collection(): Collection<NotificationDoc> {
  return getDb().collection<NotificationDoc>('notifications')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ customer_id: 1 }, { name: 'idx_notification_customer_id' })
  indexesReady = true
}

function toOut(doc: unknown): NotificationOutType {
  return NotificationOut.parse(fromDoc(doc))
}

/**
 * Build the recipient query. Rows written before `recipientRole` existed have
 * no such field, so a customer query must also match documents missing it.
 */
function recipientQuery(filter: {
  customer_id?: string
  recipientRole?: 'customer' | 'cleaner'
}): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  if (filter.customer_id) query.customer_id = filter.customer_id
  if (filter.recipientRole === 'cleaner') query.recipientRole = 'cleaner'
  else if (filter.recipientRole === 'customer') {
    query.$or = [{ recipientRole: 'customer' }, { recipientRole: { $exists: false } }]
  }
  return query
}

export async function list(
  filter: { customer_id?: string; recipientRole?: 'customer' | 'cleaner' } = {},
): Promise<NotificationOutType[]> {
  await ensureIndexes()
  const rows = await collection()
    .find(recipientQuery(filter))
    .sort({ dateCreated: -1 })
    .toArray()
  return rows.map(toOut)
}

/** Unread count for the notification tab badge. */
export async function countUnread(
  customer_id: string,
  recipientRole: 'customer' | 'cleaner' = 'customer',
): Promise<number> {
  await ensureIndexes()
  const query = recipientQuery({ customer_id, recipientRole })
  return collection().countDocuments({ ...query, read: { $ne: true } })
}

export async function getById(id: string): Promise<NotificationOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toOut(row) : null
}

export async function insert(doc: NotificationDoc): Promise<NotificationOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function update(id: string, patch: Partial<NotificationDoc>): Promise<NotificationOutType | null> {
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

/** Mark every notification for a recipient as read. Returns the modified count. */
export async function markAllRead(
  customer_id: string,
  recipientRole: 'customer' | 'cleaner' = 'customer',
): Promise<number> {
  await ensureIndexes()
  const query = recipientQuery({ customer_id, recipientRole })
  const result = await collection().updateMany(
    { ...query, read: { $ne: true } },
    { $set: { read: true, lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return result.modifiedCount
}
