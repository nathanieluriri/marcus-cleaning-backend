import type { Collection, Document, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for admin access-control workflows:
 *   - `admin_access_requests`  — elevation requests + their decisions
 *   - `admin_permission_groups` — named permission groups
 *
 * Ported from the access-request portion of `admin_service.py`. Only this layer
 * touches Mongo. See: docs/migration/07-domain-endpoints.md
 */

function requests(): Collection<Document> {
  return getDb().collection<Document>('admin_access_requests')
}
function groups(): Collection<Document> {
  return getDb().collection<Document>('admin_permission_groups')
}

const nowEpoch = () => Math.floor(Date.now() / 1000)

// --- elevation / access requests ---

export async function createRequest(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ts = nowEpoch()
  const doc = { ...data, status: 'PENDING', dateCreated: ts, lastUpdated: ts }
  const result = await requests().insertOne(doc as Document)
  const stored = await requests().findOne(idFilter(String(result.insertedId)))
  return fromDoc(stored)
}

export async function listRequests(opts: { adminId?: string; limit?: number; skip?: number } = {}): Promise<{
  items: Array<Record<string, unknown>>
  total: number
}> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const skip = Math.max(opts.skip ?? 0, 0)
  const filter: Filter<Document> = opts.adminId ? { adminId: opts.adminId } : {}
  const [rows, total] = await Promise.all([
    requests().find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    requests().countDocuments(filter),
  ])
  return { items: rows.map(fromDoc), total }
}

/** Latest elevation request for an admin (used by the status endpoint). */
export async function latestRequestForAdmin(adminId: string): Promise<Record<string, unknown> | null> {
  const row = await requests().find({ adminId }).sort({ _id: -1 }).limit(1).next()
  return row ? fromDoc(row) : null
}

export async function decideRequest(
  id: string,
  decision: string,
  deciderId: string,
  notes?: string,
): Promise<Record<string, unknown> | null> {
  await requests().updateOne(idFilter(id), {
    $set: {
      status: decision,
      decision,
      decidedBy: deciderId,
      decisionNotes: notes ?? null,
      decidedAt: nowEpoch(),
      lastUpdated: nowEpoch(),
    },
  })
  const row = await requests().findOne(idFilter(id))
  return row ? fromDoc(row) : null
}

// --- permission groups ---

export async function listGroups(): Promise<Array<Record<string, unknown>>> {
  const rows = await groups().find({}).sort({ _id: -1 }).toArray()
  return rows.map(fromDoc)
}

export async function createGroup(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ts = nowEpoch()
  const doc = { ...data, dateCreated: ts, lastUpdated: ts }
  const result = await groups().insertOne(doc as Document)
  const stored = await groups().findOne(idFilter(String(result.insertedId)))
  return fromDoc(stored)
}
