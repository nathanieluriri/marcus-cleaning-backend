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

export async function list(filter: { customer_id?: string } = {}): Promise<NotificationOutType[]> {
  await ensureIndexes()
  const query: Record<string, unknown> = {}
  if (filter.customer_id) query.customer_id = filter.customer_id
  const rows = await collection().find(query).sort({ dateCreated: -1 }).toArray()
  return rows.map(toOut)
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

/** Mark every notification for a customer as read. Returns the modified count. */
export async function markAllRead(customer_id: string): Promise<number> {
  await ensureIndexes()
  const result = await collection().updateMany(
    { customer_id, read: { $ne: true } },
    { $set: { read: true, lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return result.modifiedCount
}
