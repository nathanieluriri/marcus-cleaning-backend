import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { SavedAddressOut, type SavedAddressDoc, type SavedAddressOut as SavedAddressOutType } from '@/server/schemas/saved-address'
import { idFilter, toObjectId, fromDoc } from './_helpers'

/**
 * Data access for the `saved_addresses` collection.
 * CRUD scoped by customer, plus set-default (single default per customer).
 * Only this layer touches Mongo.
 *
 * See: docs/migration/02-data-model.md (Places & addresses).
 */

let indexesReady = false

function collection(): Collection<SavedAddressDoc> {
  return getDb().collection<SavedAddressDoc>('saved_addresses')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ customerId: 1 }, { name: 'idx_saved_address_customer' })
  await collection().createIndex({ customerId: 1, isDefault: 1 }, { name: 'idx_saved_address_default' })
  indexesReady = true
}

function toOut(doc: unknown): SavedAddressOutType {
  return SavedAddressOut.parse(fromDoc(doc))
}

export async function listByCustomer(customerId: string): Promise<SavedAddressOutType[]> {
  await ensureIndexes()
  const docs = await collection()
    .find({ customerId })
    .sort({ isDefault: -1, dateCreated: -1 })
    .toArray()
  return docs.map(toOut)
}

export async function findById(customerId: string, addressId: string): Promise<SavedAddressOutType | null> {
  await ensureIndexes()
  const doc = await collection().findOne({ ...idFilter(addressId), customerId } as Record<string, unknown>)
  return doc ? toOut(doc) : null
}

/**
 * Look up a customer's saved address by Google `placeId` (used to resolve a
 * booking's `formattedAddress` for display enrichment). Returns null if the
 * customer never saved that place.
 */
export async function findByPlaceId(customerId: string, placeId: string): Promise<SavedAddressOutType | null> {
  await ensureIndexes()
  const doc = await collection().findOne({ customerId, placeId })
  return doc ? toOut(doc) : null
}

export async function insertAddress(doc: SavedAddressDoc): Promise<SavedAddressOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  patch: Partial<SavedAddressDoc>,
): Promise<SavedAddressOutType | null> {
  await ensureIndexes()
  await collection().updateOne(
    { ...idFilter(addressId), customerId } as Record<string, unknown>,
    { $set: patch },
  )
  return findById(customerId, addressId)
}

export async function deleteAddress(customerId: string, addressId: string): Promise<boolean> {
  await ensureIndexes()
  const res = await collection().deleteOne({ ...idFilter(addressId), customerId } as Record<string, unknown>)
  return res.deletedCount > 0
}

/**
 * Mark a single address as default for the customer, clearing the flag on all
 * others in the same query batch. Returns the updated address (or null if the
 * target does not belong to the customer).
 */
export async function setDefault(
  customerId: string,
  addressId: string,
  at: number,
): Promise<SavedAddressOutType | null> {
  await ensureIndexes()
  const target = await collection().findOne({ ...idFilter(addressId), customerId } as Record<string, unknown>)
  if (!target) return null

  await collection().updateMany(
    { customerId, isDefault: true },
    { $set: { isDefault: false, lastUpdated: at } },
  )
  await collection().updateOne(
    { _id: toObjectId(addressId) } as Record<string, unknown>,
    { $set: { isDefault: true, lastUpdated: at } },
  )
  return findById(customerId, addressId)
}

export type SavedAddressRow = WithId<SavedAddressDoc>
