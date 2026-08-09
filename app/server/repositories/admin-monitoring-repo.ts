import { ObjectId, type Collection, type Document, type Filter } from 'mongodb'
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

/**
 * Audit-event document shape assumed by the filters below.
 *
 * No writer exists yet — nothing in the codebase inserts `kind: 'audit_event'`
 * documents, so `/monitoring/audit/history` reads an empty collection today. These
 * field names are therefore a *contract for the future writer* rather than a
 * description of stored data: camelCase to match the rest of the repo layer
 * (`alertType`, `readBy`, `dateCreated`), with `dateCreated` in epoch seconds.
 * A writer that picks different names silently breaks every filter here.
 */
export type AuditSortDirection = 'asc' | 'desc'

export interface AuditEventListOptions {
  limit?: number
  skip?: number
  cursor?: string
  sort?: AuditSortDirection
  actorId?: string
  targetId?: string
  endpoint?: string
  eventType?: string
  status?: string
  severity?: string
  tags?: string[]
  fromEpoch?: number
  toEpoch?: number
}

export interface AlertListOptions {
  limit?: number
  skip?: number
  slaOnly?: boolean
  unreadOnly?: boolean
  status?: 'open' | 'acknowledged'
  hours?: number
}

/**
 * Keep only non-empty string filters. A cleared filter input arrives as `''`, and
 * an equality match on `''` would match nothing rather than everything.
 */
function equalityFilters(pairs: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(pairs)) {
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

/**
 * Build a `dateCreated` range, ignoring non-positive bounds. A cleared date input
 * arrives as `to_epoch=`, which `z.coerce.number()` turns into 0 (`Number('') === 0`);
 * honouring that as `$lte: 0` would match nothing instead of meaning "no bound".
 * Epoch 0 is not a meaningful bound here regardless — it predates the system.
 */
function epochRange(from?: number, to?: number): Record<string, number> | undefined {
  const range: Record<string, number> = {}
  if (typeof from === 'number' && from > 0) range.$gte = from
  if (typeof to === 'number' && to > 0) range.$lte = to
  return Object.keys(range).length > 0 ? range : undefined
}

// --- audit history (events) ---

export async function listAuditEvents(opts: AuditEventListOptions = {}): Promise<ListResult> {
  const limit = clamp(opts.limit, 50)
  const direction = opts.sort === 'asc' ? 1 : -1

  const filter: Filter<Document> = {
    kind: 'audit_event',
    ...equalityFilters({
      actorId: opts.actorId,
      targetId: opts.targetId,
      endpoint: opts.endpoint,
      eventType: opts.eventType,
      status: opts.status,
      severity: opts.severity,
    }),
  }
  if (opts.tags && opts.tags.length > 0) filter.tags = { $all: opts.tags }
  const range = epochRange(opts.fromEpoch, opts.toEpoch)
  if (range) filter.dateCreated = range

  // `total` must describe the whole matching set, so it is counted before the
  // cursor bound is applied — otherwise it would shrink with every page turn.
  const countFilter: Filter<Document> = { ...filter }

  // A cursor already positions the reader; combining it with `skip` would skip a
  // second page on top of it and silently drop rows.
  const cursorId = opts.cursor && ObjectId.isValid(opts.cursor) ? new ObjectId(opts.cursor) : null
  if (cursorId) filter._id = direction === -1 ? { $lt: cursorId } : { $gt: cursorId }
  const skip = cursorId ? 0 : Math.max(opts.skip ?? 0, 0)

  const [rows, total] = await Promise.all([
    monitoring().find(filter).sort({ _id: direction }).skip(skip).limit(limit).toArray(),
    monitoring().countDocuments(countFilter),
  ])
  return { items: rows.map(fromDoc), total }
}

export async function getAuditEventById(id: string): Promise<Record<string, unknown> | null> {
  const row = await monitoring().findOne({ ...idFilter(id), kind: 'audit_event' })
  return row ? fromDoc(row) : null
}

// --- alerts ---

export async function listAlerts(opts: AlertListOptions = {}): Promise<ListResult> {
  const limit = clamp(opts.limit, 50)
  const skip = Math.max(opts.skip ?? 0, 0)
  const filter: Filter<Document> = { kind: 'alert' }
  if (opts.slaOnly) filter.alertType = 'SLA'

  // Alerts are stored without `read`/`acknowledged` until an admin acts on them,
  // so these match "not true" rather than `false` — an equality match on `false`
  // would miss every alert nobody has touched, i.e. exactly the ones being asked for.
  if (opts.unreadOnly) filter.read = { $ne: true }
  if (opts.status === 'open') filter.acknowledged = { $ne: true }
  else if (opts.status === 'acknowledged') filter.acknowledged = true

  if (typeof opts.hours === 'number' && opts.hours > 0) {
    filter.dateCreated = { $gte: Math.floor(Date.now() / 1000) - opts.hours * 3600 }
  }

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
