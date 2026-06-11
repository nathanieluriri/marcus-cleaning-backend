import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  PaymentMethodOut,
  type PaymentMethodDoc,
  type PaymentMethodOut as PaymentMethodOutType,
} from '@/server/schemas/payment'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `payment_methods` collection.
 * Ported from `repositories/payment_method_repo.py`. Only this layer touches Mongo.
 *
 * See: docs/migration/02-data-model.md
 */

let indexesReady = false

function collection(): Collection<PaymentMethodDoc> {
  return getDb().collection<PaymentMethodDoc>('payment_methods')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex({ customerId: 1 }, { name: 'idx_payment_method_customer' })
  await col.createIndex({ customerId: 1, isDefault: 1 }, { name: 'idx_payment_method_customer_default' })
  indexesReady = true
}

export async function create(doc: PaymentMethodDoc): Promise<PaymentMethodOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return PaymentMethodOut.parse(fromDoc(stored))
}

export async function getById(id: string): Promise<WithId<PaymentMethodDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function listByCustomer(customerId: string): Promise<PaymentMethodOutType[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ customerId })
    .sort({ isDefault: -1, dateCreated: -1 })
    .toArray()
  return rows.map((r) => PaymentMethodOut.parse(fromDoc(r)))
}

export async function update(
  id: string,
  patch: Partial<PaymentMethodDoc>,
): Promise<WithId<PaymentMethodDoc> | null> {
  await ensureIndexes()
  const set: Record<string, unknown> = { ...patch, lastUpdated: Math.floor(Date.now() / 1000) }
  await collection().updateOne(idFilter(id), { $set: set })
  return collection().findOne(idFilter(id))
}

export async function remove(id: string): Promise<number> {
  await ensureIndexes()
  const result = await collection().deleteOne(idFilter(id))
  return result.deletedCount ?? 0
}

/** Set one method as default for a customer, clearing the flag on the rest. */
export async function setDefault(customerId: string, id: string): Promise<WithId<PaymentMethodDoc> | null> {
  await ensureIndexes()
  const ts = Math.floor(Date.now() / 1000)
  await collection().updateMany(
    { customerId, _id: { $ne: idFilter(id)._id } } as Record<string, unknown>,
    { $set: { isDefault: false, lastUpdated: ts } },
  )
  await collection().updateOne(idFilter(id), { $set: { isDefault: true, lastUpdated: ts } })
  return collection().findOne(idFilter(id))
}

/** Parse a raw payment-method doc into the public view. */
export function toPaymentMethodOut(doc: unknown): PaymentMethodOutType {
  return PaymentMethodOut.parse(fromDoc(doc))
}
