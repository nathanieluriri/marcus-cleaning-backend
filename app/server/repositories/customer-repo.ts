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
  await collection().createIndex(
    { authProvider: 1, authSubject: 1 },
    { name: 'idx_customer_auth_subject', sparse: true },
  )
  await collection().createIndex({ accountStatus: 1 }, { name: 'idx_customer_account_status' })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<CustomerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

/**
 * Look up an account by the identity-provider subject it was linked with.
 *
 * This is the SAFE key for social sign-in: the subject is issued by the
 * provider and cannot be claimed by another user, whereas an email in an
 * unverified token can be set to anything.
 */
export async function findByAuthSubject(
  authProvider: string,
  authSubject: string,
): Promise<WithId<CustomerDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ authProvider, authSubject })
}

export async function findById(id: string): Promise<WithId<CustomerDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

/** Ids of all ACTIVE customers — the base population for broadcasts. */
export async function listActiveIds(): Promise<string[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ accountStatus: 'ACTIVE' }, { projection: { _id: 1 } })
    .toArray()
  return rows.map((r) => String(r._id))
}

/**
 * Ids that have explicitly turned marketing notifications OFF.
 *
 * Only an explicit `false` counts — an account that has never touched the
 * setting is opted IN, matching the documented default.
 */
export async function listMarketingOptOutIds(): Promise<string[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ 'settings.notifications.marketing': false }, { projection: { _id: 1 } })
    .toArray()
  return rows.map((r) => String(r._id))
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
