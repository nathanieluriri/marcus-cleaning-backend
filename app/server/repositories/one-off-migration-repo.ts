import type { Collection, Document } from 'mongodb'
import { getDb } from '@/server/core/mongo'

/**
 * Data access for the throwaway admin-feature-field migration endpoint.
 * See `server/routes/one-off-migration.ts` for the full context — this repo
 * is the only place that touches Mongo for that endpoint, per the layering
 * rule (`routes -> services -> repositories`).
 */

/** Fixed `_id` for the run-once marker. Never generated — its fixedness IS the guarantee. */
export const MIGRATION_MARKER_ID = 'admin-feature-fields-migration'
const MARKER_COLLECTION = '_one_off_migration_runs'

export interface MigrationMarker {
  _id: string
  startedAt: string
  completedAt?: string
  summary?: unknown
}

function markerCollection(): Collection<MigrationMarker> {
  return getDb().collection<MigrationMarker>(MARKER_COLLECTION)
}

function collection(name: string): Collection<Document> {
  return getDb().collection<Document>(name)
}

/**
 * Read-only: distinct top-level key names per collection, with document
 * counts, computed server-side via aggregation (never loads full documents).
 */
export async function censusCollection(name: string): Promise<Array<{ key: string; count: number }>> {
  const rows = await collection(name)
    .aggregate<{ _id: string; count: number }>([
      { $project: { fields: { $objectToArray: '$$ROOT' } } },
      { $unwind: '$fields' },
      { $group: { _id: '$fields.k', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray()
  return rows.map((r) => ({ key: r._id, count: r.count }))
}

/** Read-only: every document in the collection. These admin catalogs are small (dozens of docs). */
export async function getAllDocuments(name: string): Promise<Array<Record<string, unknown>>> {
  return collection(name).find({}).toArray() as Promise<Array<Record<string, unknown>>>
}

/** Write: apply a precomputed patch under the given precondition filter. Returns true iff it actually wrote. */
export async function applyPatch(
  name: string,
  filter: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const result = await collection(name).updateOne(filter, { $set: patch })
  return result.modifiedCount > 0
}

/**
 * Atomically claim the run-once marker via `insertOne` on a FIXED `_id`.
 * Returns `true` if this call claimed it, `false` if it was already claimed
 * (duplicate key — E11000). This is a real atomic compare-and-set at the
 * database level: two concurrent callers both attempting `insertOne` on the
 * same `_id` race, and Mongo guarantees exactly one succeeds. There is no
 * find-then-insert gap here.
 */
export async function claimMigrationMarker(startedAt: string): Promise<boolean> {
  try {
    await markerCollection().insertOne({ _id: MIGRATION_MARKER_ID, startedAt })
    return true
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) return false
    throw err
  }
}

/** Read-only: fetch the marker (present once the migration has ever run, claimed or completed). */
export async function getMigrationMarker(): Promise<MigrationMarker | null> {
  const doc = await markerCollection().findOne({ _id: MIGRATION_MARKER_ID })
  return doc as MigrationMarker | null
}

/** Record the completed run's summary onto the already-claimed marker. */
export async function completeMigrationMarker(completedAt: string, summary: unknown): Promise<void> {
  await markerCollection().updateOne({ _id: MIGRATION_MARKER_ID }, { $set: { completedAt, summary } })
}
