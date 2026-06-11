import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { PaymentOut, type PaymentDoc, type PaymentOut as PaymentOutType, type PaymentStatus } from '@/server/schemas/payment'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `payments` collection.
 * Ported from `repositories/payment_repo.py`. Only this layer touches Mongo.
 *
 * See: docs/migration/02-data-model.md, docs/migration/09-payments.md
 */

let indexesReady = false

function collection(): Collection<PaymentDoc> {
  return getDb().collection<PaymentDoc>('payments')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ reference: 1 }, { name: 'idx_payment_reference', unique: true })
  await col.createIndex({ providerReference: 1 }, { name: 'idx_payment_provider_reference', sparse: true })
  // Idempotency for webhook redelivery (sparse: not every row has an event id).
  await col.createIndex(
    { providerEventId: 1 },
    { name: 'idx_payment_provider_event_id', unique: true, sparse: true },
  )
  await col.createIndex({ customerId: 1 }, { name: 'idx_payment_customer' })
  await col.createIndex({ status: 1, lastUpdated: 1 }, { name: 'idx_payment_status_updated' })
  indexesReady = true
}

export async function create(doc: PaymentDoc): Promise<PaymentOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return PaymentOut.parse(fromDoc(stored))
}

export async function getById(id: string): Promise<WithId<PaymentDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function getByReference(reference: string): Promise<WithId<PaymentDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ reference })
}

export async function getByProviderEventId(eventId: string): Promise<WithId<PaymentDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ providerEventId: eventId })
}

/**
 * Set the status (idempotent set-semantics, never increment). Optionally records
 * the provider event id (for webhook idempotency) and provider reference.
 */
export async function updateStatus(
  id: string,
  status: PaymentStatus,
  extra?: { providerReference?: string | null; providerEventId?: string | null },
): Promise<WithId<PaymentDoc> | null> {
  await ensureIndexes()
  const set: Record<string, unknown> = { status, lastUpdated: Math.floor(Date.now() / 1000) }
  if (extra?.providerReference !== undefined) set.providerReference = extra.providerReference
  if (extra?.providerEventId !== undefined) set.providerEventId = extra.providerEventId
  await collection().updateOne(idFilter(id), { $set: set })
  return collection().findOne(idFilter(id))
}

/** Pending/processing payments older than nothing — oldest first, capped at `limit`. */
export async function findPending(limit: number): Promise<WithId<PaymentDoc>[]> {
  await ensureIndexes()
  return collection()
    .find({ status: { $in: ['pending', 'processing'] } })
    .sort({ lastUpdated: 1 })
    .limit(limit)
    .toArray()
}

/** Parse a raw payment doc into the public PaymentOut view. */
export function toPaymentOut(doc: unknown): PaymentOutType {
  return PaymentOut.parse(fromDoc(doc))
}
