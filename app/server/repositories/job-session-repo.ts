import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  JobSessionOut,
  SosAlertOut,
  durationOf,
  type ChecklistTask,
  type JobSessionDoc,
  type JobSessionOut as JobSessionOutType,
  type SosAlertDoc,
  type SosAlertOut as SosAlertOutType,
} from '@/server/schemas/job-session'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for `job_sessions` and `sos_alerts`. Only this layer touches Mongo.
 */

let indexesReady = false

function sessions(): Collection<JobSessionDoc> {
  return getDb().collection<JobSessionDoc>('job_sessions')
}

function alerts(): Collection<SosAlertDoc> {
  return getDb().collection<SosAlertDoc>('sos_alerts')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  // One session per booking — this is what makes `start` safely repeatable.
  await sessions().createIndex({ bookingId: 1 }, { name: 'uniq_job_session_booking', unique: true })
  await sessions().createIndex({ cleanerId: 1 }, { name: 'idx_job_session_cleaner' })
  await alerts().createIndex({ status: 1, dateCreated: -1 }, { name: 'idx_sos_status' })
  await alerts().createIndex({ cleanerId: 1 }, { name: 'idx_sos_cleaner' })
  indexesReady = true
}

function toSession(doc: unknown, now: number): JobSessionOutType {
  const raw = fromDoc(doc) as Record<string, unknown> & { startedAt: number; completedAt?: number | null }
  return JobSessionOut.parse({ ...raw, durationSeconds: durationOf(raw, now) })
}

function toAlert(doc: unknown): SosAlertOutType {
  return SosAlertOut.parse(fromDoc(doc))
}

export async function getByBookingId(bookingId: string, now: number): Promise<JobSessionOutType | null> {
  await ensureIndexes()
  const row = await sessions().findOne({ bookingId })
  return row ? toSession(row, now) : null
}

/**
 * Create the session for a booking, or return the existing one.
 * Concurrent `start` calls therefore converge on a single authoritative
 * `startedAt` instead of racing.
 */
export async function startSession(doc: JobSessionDoc, now: number): Promise<JobSessionOutType> {
  await ensureIndexes()
  await sessions().updateOne({ bookingId: doc.bookingId }, { $setOnInsert: doc }, { upsert: true })
  const stored = await sessions().findOne({ bookingId: doc.bookingId })
  return toSession(stored, now)
}

export async function updateSession(
  bookingId: string,
  set: Partial<JobSessionDoc>,
  now: number,
): Promise<JobSessionOutType | null> {
  await ensureIndexes()
  await sessions().updateOne({ bookingId }, { $set: { ...set, lastUpdated: now } })
  const stored = await sessions().findOne({ bookingId })
  return stored ? toSession(stored, now) : null
}

/** Toggle one checklist entry in place. Returns null when the task id is unknown. */
export async function setChecklistTask(
  bookingId: string,
  taskId: string,
  done: boolean,
  now: number,
): Promise<JobSessionOutType | null> {
  await ensureIndexes()
  const result = await sessions().updateOne(
    { bookingId, 'checklist.taskId': taskId },
    {
      $set: {
        'checklist.$.done': done,
        'checklist.$.doneAt': done ? now : null,
        lastUpdated: now,
      },
    },
  )
  if (result.matchedCount === 0) return null
  const stored = await sessions().findOne({ bookingId })
  return stored ? toSession(stored, now) : null
}

/** Sessions a cleaner completed within a window — the earnings data source. */
export async function completedBetween(
  cleanerId: string,
  fromEpoch: number,
  toEpoch: number,
  now: number,
): Promise<JobSessionOutType[]> {
  await ensureIndexes()
  const rows = await sessions()
    .find({ cleanerId, status: 'COMPLETED', completedAt: { $gte: fromEpoch, $lt: toEpoch } })
    .sort({ completedAt: 1 })
    .toArray()
  return rows.map((r) => toSession(r, now))
}

// --- SOS -------------------------------------------------------------------

export async function insertAlert(doc: SosAlertDoc): Promise<SosAlertOutType> {
  await ensureIndexes()
  const result = await alerts().insertOne(doc)
  const stored = await alerts().findOne(idFilter(String(result.insertedId)))
  return toAlert(stored)
}

export async function listOpenAlerts(limit = 50): Promise<SosAlertOutType[]> {
  await ensureIndexes()
  const rows = await alerts()
    .find({ status: { $ne: 'RESOLVED' } })
    .sort({ dateCreated: -1 })
    .limit(limit)
    .toArray()
  return rows.map(toAlert)
}

export async function updateAlert(
  id: string,
  set: Partial<SosAlertDoc>,
): Promise<SosAlertOutType | null> {
  await ensureIndexes()
  await alerts().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  const stored = await alerts().findOne(idFilter(id))
  return stored ? toAlert(stored) : null
}

/** Snapshot of a session's checklist (used when building the completion summary). */
export function countTasks(checklist: ChecklistTask[]): { done: number; total: number } {
  return { done: checklist.filter((t) => t.done).length, total: checklist.length }
}
