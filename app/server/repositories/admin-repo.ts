import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { AdminOut, type AdminDoc, type AdminOut as AdminOutType } from '@/server/schemas/admin'
import { idFilter, fromDoc } from './_helpers'

/** Data access for the `admins` collection. Ported from `repositories/admin_repo.py`. */

let indexesReady = false

function collection(): Collection<AdminDoc> {
  return getDb().collection<AdminDoc>('admins')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ email: 1 }, { name: 'idx_admin_email', unique: true })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<AdminDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

export async function findById(id: string): Promise<WithId<AdminDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function insertAdmin(doc: AdminDoc): Promise<AdminOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return AdminOut.parse(fromDoc(stored))
}

export async function updateLastAuthAt(id: string, epochSeconds: number): Promise<void> {
  await collection().updateOne(idFilter(id), { $set: { lastAuthAt: epochSeconds, lastUpdated: epochSeconds } })
}

export function toAdminOut(doc: unknown): AdminOutType {
  return AdminOut.parse(fromDoc(doc))
}
