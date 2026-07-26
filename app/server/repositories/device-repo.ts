import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { DeviceOut, type DeviceDoc, type DeviceOut as DeviceOutType } from '@/server/schemas/device'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `devices` collection (push registration tokens).
 * Only this layer touches Mongo.
 */

let indexesReady = false

function collection(): Collection<DeviceDoc> {
  return getDb().collection<DeviceDoc>('devices')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ token: 1 }, { name: 'uniq_device_token', unique: true })
  await col.createIndex({ userId: 1, role: 1 }, { name: 'idx_device_user' })
  indexesReady = true
}

function toOut(doc: unknown): DeviceOutType {
  return DeviceOut.parse(fromDoc(doc))
}

/**
 * Register (or re-point) a device token. Upsert on `token` so the same install
 * re-registering — possibly under a different account — updates in place.
 */
export async function upsertByToken(doc: DeviceDoc): Promise<DeviceOutType> {
  await ensureIndexes()
  const { dateCreated, ...mutable } = doc
  await collection().updateOne(
    { token: doc.token },
    { $set: { ...mutable, disabledAt: null }, $setOnInsert: { dateCreated } },
    { upsert: true },
  )
  const stored = await collection().findOne({ token: doc.token })
  return toOut(stored)
}

/** Active (non-disabled) tokens for a user. */
export async function listActiveFor(
  userId: string,
  role: 'customer' | 'cleaner',
): Promise<DeviceOutType[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ userId, role, $or: [{ disabledAt: null }, { disabledAt: { $exists: false } }] })
    .toArray()
  return rows.map(toOut)
}

export async function listFor(userId: string, role: 'customer' | 'cleaner'): Promise<DeviceOutType[]> {
  await ensureIndexes()
  const rows = await collection().find({ userId, role }).toArray()
  return rows.map(toOut)
}

/** Remove a registration. Scoped to the owner so one user cannot unregister another's. */
export async function removeById(
  id: string,
  userId: string,
  role: 'customer' | 'cleaner',
): Promise<boolean> {
  await ensureIndexes()
  const result = await collection().deleteOne({ ...idFilter(id), userId, role } as never)
  return result.deletedCount > 0
}

export async function removeByToken(token: string): Promise<boolean> {
  await ensureIndexes()
  const result = await collection().deleteOne({ token })
  return result.deletedCount > 0
}

/** Mark a token the provider rejected as permanently invalid. */
export async function disableToken(token: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(
    { token },
    { $set: { disabledAt: Math.floor(Date.now() / 1000), lastUpdated: Math.floor(Date.now() / 1000) } },
  )
}
