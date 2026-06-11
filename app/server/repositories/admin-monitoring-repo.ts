import type { Collection, Document, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for admin monitoring: audit history/events, SLA alerts, and
 * on-demand audit exports. Ported from `admin_monitoring_repo.py`.
 *
 * Collections:
 *   - `admin_monitoring`  — audit events + alerts (discriminated by `kind`)
 *   - `audit_exports`     — generated export job records (on-demand, no Celery)
 *
 * Only this layer touches Mongo. See: docs/migration/10-background-and-cron.md
 */

function monitoring(): Collection<Document> {
  return getDb().collection<Document>('admin_monitoring')
}
function exports(): Collection<Document> {
  return getDb().collection<Document>('audit_exports')
}

const clamp = (n: number | undefined, def: number) => Math.min(Math.max(n ?? def, 1), 500)

export interface ListResult {
  items: Array<Record<string, unknown>>
  total: number
}

// --- audit history (events) ---

export async function listAuditEvents(opts: { limit?: number; skip?: number } = {}): Promise<ListResult> {
  const limit = clamp(opts.limit, 50)
  const skip = Math.max(opts.skip ?? 0, 0)
  const filter: Filter<Document> = { kind: 'audit_event' }
  const [rows, total] = await Promise.all([
    monitoring().find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    monitoring().countDocuments(filter),
  ])
  return { items: rows.map(fromDoc), total }
}

export async function getAuditEventById(id: string): Promise<Record<string, unknown> | null> {
  const row = await monitoring().findOne({ ...idFilter(id), kind: 'audit_event' })
  return row ? fromDoc(row) : null
}

// --- alerts ---

export async function listAlerts(opts: { limit?: number; skip?: number; slaOnly?: boolean } = {}): Promise<ListResult> {
  const limit = clamp(opts.limit, 50)
  const skip = Math.max(opts.skip ?? 0, 0)
  const filter: Filter<Document> = opts.slaOnly
    ? { kind: 'alert', alertType: 'SLA' }
    : { kind: 'alert' }
  const [rows, total] = await Promise.all([
    monitoring().find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    monitoring().countDocuments(filter),
  ])
  return { items: rows.map(fromDoc), total }
}

export async function setAlertFlag(
  id: string,
  field: 'read' | 'acknowledged',
  adminId: string,
): Promise<Record<string, unknown> | null> {
  const ts = Math.floor(Date.now() / 1000)
  const set =
    field === 'read'
      ? { read: true, readAt: ts, readBy: adminId }
      : { acknowledged: true, acknowledgedAt: ts, acknowledgedBy: adminId }
  await monitoring().updateOne({ ...idFilter(id), kind: 'alert' }, { $set: set })
  const row = await monitoring().findOne({ ...idFilter(id), kind: 'alert' })
  return row ? fromDoc(row) : null
}

// --- audit exports (on-demand) ---

export async function createExport(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ts = Math.floor(Date.now() / 1000)
  // On-demand generation: the export is ready immediately (synchronous model).
  // TODO: for large exports switch to cron-backed `pending` -> `ready` drain.
  const doc = { ...data, status: 'ready', dateCreated: ts, lastUpdated: ts }
  const result = await exports().insertOne(doc as Document)
  const stored = await exports().findOne(idFilter(String(result.insertedId)))
  return fromDoc(stored)
}

export async function getExportById(id: string): Promise<Record<string, unknown> | null> {
  const row = await exports().findOne(idFilter(id))
  return row ? fromDoc(row) : null
}
