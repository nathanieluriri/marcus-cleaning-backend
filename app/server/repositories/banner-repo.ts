import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { BannerOut, type BannerDoc, type BannerOut as BannerOutType } from '@/server/schemas/banner'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for the `banner` collection.
 * Ported from `repositories/banner.py`. Only this layer touches Mongo.
 * See: docs/migration/06-services-and-repositories.md
 */

let indexesReady = false

function collection(): Collection<BannerDoc> {
  return getDb().collection<BannerDoc>('banner')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ active: 1, sortOrder: 1 }, { name: 'idx_banner_active_sort' })
  indexesReady = true
}

function toOut(doc: unknown): BannerOutType {
  return BannerOut.parse(fromDoc(doc))
}

export async function list(): Promise<BannerOutType[]> {
  await ensureIndexes()
  const rows = await collection().find({}).sort({ sortOrder: 1, dateCreated: -1 }).toArray()
  return rows.map(toOut)
}

export async function getById(id: string): Promise<BannerOutType | null> {
  await ensureIndexes()
  const row = await collection().findOne(idFilter(id))
  return row ? toOut(row) : null
}

export async function insert(doc: BannerDoc): Promise<BannerOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toOut(stored)
}

export async function update(id: string, patch: Partial<BannerDoc>): Promise<BannerOutType | null> {
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
