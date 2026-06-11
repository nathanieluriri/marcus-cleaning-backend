import type { Collection, Document, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter, fromDoc } from '../_helpers'

/**
 * Generic CRUD data access for the admin-feature collections.
 *
 * Each admin-feature sub-router (service-definitions, add-ons, pricing-rules, ...)
 * is backed by a single Mongo collection with the standard CRUD shape. Rather than
 * hand-writing 13 near-identical repos, this module provides one parametric repo
 * keyed by collection name. Only this layer touches Mongo (per the layering rule).
 *
 * See: docs/migration/06-services-and-repositories.md
 */

const nowEpoch = () => Math.floor(Date.now() / 1000)

function collection(name: string): Collection<Document> {
  return getDb().collection<Document>(name)
}

export interface ListResult {
  items: Array<Record<string, unknown>>
  total: number
}

export interface ListOptions {
  limit?: number
  skip?: number
  filter?: Filter<Document>
}

export async function listDocs(name: string, opts: ListOptions = {}): Promise<ListResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const skip = Math.max(opts.skip ?? 0, 0)
  const filter = (opts.filter ?? {}) as Filter<Document>
  const coll = collection(name)
  const [rows, total] = await Promise.all([
    coll.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    coll.countDocuments(filter),
  ])
  return { items: rows.map(fromDoc), total }
}

export async function getDocById(name: string, id: string): Promise<Record<string, unknown> | null> {
  const row = await collection(name).findOne(idFilter(id))
  return row ? fromDoc(row) : null
}

export async function insertDoc(
  name: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ts = nowEpoch()
  const doc = { ...data, dateCreated: ts, lastUpdated: ts }
  const result = await collection(name).insertOne(doc as Document)
  const stored = await collection(name).findOne(idFilter(String(result.insertedId)))
  return fromDoc(stored)
}

export async function updateDoc(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { id: _ignore, ...rest } = data
  void _ignore
  await collection(name).updateOne(idFilter(id), {
    $set: { ...rest, lastUpdated: nowEpoch() },
  })
  return getDocById(name, id)
}

export async function deleteDoc(name: string, id: string): Promise<boolean> {
  const result = await collection(name).deleteOne(idFilter(id))
  return result.deletedCount > 0
}

/** Insert a raw document (used by feature extras such as credit grants / dispatch logs). */
export async function insertRaw(
  name: string,
  doc: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await collection(name).insertOne(doc as Document)
  const stored = await collection(name).findOne(idFilter(String(result.insertedId)))
  return fromDoc(stored)
}

/** Aggregate a numeric field across docs matching a filter (used for credit balances). */
export async function sumField(
  name: string,
  field: string,
  filter: Filter<Document>,
): Promise<number> {
  const rows = await collection(name)
    .aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$${field}` } } }])
    .toArray()
  return rows.length > 0 ? Number(rows[0].total ?? 0) : 0
}
