import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { CustomerOut, type CustomerDoc, type CustomerOut as CustomerOutType } from '@/server/schemas/customer'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `customers` collection.
 * Ported from `repositories/customer_repo.py`. Only this layer touches Mongo.
 */

let indexesReady = false

function collection(): Collection<CustomerDoc> {
  return getDb().collection<CustomerDoc>('customers')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ email: 1 }, { name: 'idx_customer_email', unique: true })
  await collection().createIndex({ accountStatus: 1 }, { name: 'idx_customer_account_status' })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<CustomerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

export async function findById(id: string): Promise<WithId<CustomerDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function insertCustomer(doc: CustomerDoc): Promise<CustomerOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return CustomerOut.parse(fromDoc(stored))
}

export async function updateLastAuthAt(id: string, epochSeconds: number): Promise<void> {
  await collection().updateOne(idFilter(id), { $set: { lastAuthAt: epochSeconds, lastUpdated: epochSeconds } })
}

/** Parse a raw customer doc into the public CustomerOut view. */
export function toCustomerOut(doc: unknown): CustomerOutType {
  return CustomerOut.parse(fromDoc(doc))
}

/** Set a new bcrypt password hash for a customer. */
export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { password: passwordHash, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}
