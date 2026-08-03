import { buildUpdateFilter, migrateAddOn, migratePromoCode, migrateServiceDefinition, type MigrationResult } from '@/server/services/admin-feature-migration'
import * as repo from '@/server/repositories/one-off-migration-repo'

/**
 * Shared runner for the admin-feature-field migration: the summary-building
 * logic used by BOTH `server/scripts/migrate-admin-feature-fields.ts` (local,
 * shell-driven) and `server/routes/one-off-migration.ts` (the temporary
 * ungated HTTP endpoint — see that file for why it exists). Keeping this in
 * one place means the route can never drift from the already-tested script
 * behaviour: same census, same dry-run/apply computation, same conflict and
 * withheld-field reporting, same never-clobber precondition on write.
 *
 * The actual field-mapping rules live in `admin-feature-migration.ts` (pure,
 * no Mongo import, unit-tested there). This module is the orchestration layer
 * that reads documents, calls those pure functions, and — only when
 * `apply: true` — writes the computed patch back through the repository.
 */

export interface CollectionSpec {
  collection: string
  label: string
  migrate: (doc: Record<string, unknown>) => MigrationResult
}

export const MIGRATION_SPECS: CollectionSpec[] = [
  { collection: 'service_definitions', label: 'service_definitions', migrate: migrateServiceDefinition },
  { collection: 'addon_catalog', label: 'addon_catalog', migrate: migrateAddOn },
  { collection: 'promo_code', label: 'promo_code', migrate: migratePromoCode },
]

export interface CollectionSummary {
  label: string
  scanned: number
  migrated: number
  skippedAlreadyCanonical: number
  conflicting: number
  unrecognised: number
  invalid: number
  flaggedForHumanReview: number
  conflictIds: string[]
  /** _id -> canonical keys that migrated cleanly but were withheld because a sibling field conflicts. */
  withheldByConflictId: Record<string, string[]>
  withheldFieldTotal: number
  flaggedFieldCounts: Record<string, number>
}

function emptySummary(label: string): CollectionSummary {
  return {
    label,
    scanned: 0,
    migrated: 0,
    skippedAlreadyCanonical: 0,
    conflicting: 0,
    unrecognised: 0,
    invalid: 0,
    flaggedForHumanReview: 0,
    conflictIds: [],
    withheldByConflictId: {},
    withheldFieldTotal: 0,
    flaggedFieldCounts: {},
  }
}

/**
 * `apply: false` (dry run) never calls the repository's write path — it only
 * computes and returns the summary, which is the whole of the dry-run
 * guarantee.
 */
export async function runCollectionMigration(spec: CollectionSpec, apply: boolean): Promise<CollectionSummary> {
  const docs = await repo.getAllDocuments(spec.collection)
  const summary = emptySummary(spec.label)

  for (const doc of docs) {
    summary.scanned += 1
    const result = spec.migrate(doc)

    if (result.invalid.length > 0) summary.invalid += 1
    if (result.flagged.length > 0) {
      summary.flaggedForHumanReview += 1
      for (const field of result.flagged) {
        summary.flaggedFieldCounts[field] = (summary.flaggedFieldCounts[field] ?? 0) + 1
      }
    }

    // A real contradiction is always surfaced, even if some other field on
    // the same doc would also migrate cleanly.
    if (result.conflicts.length > 0) {
      summary.conflicting += 1
      const id = String(doc._id)
      summary.conflictIds.push(id)
      if (result.withheldKeys.length > 0) {
        summary.withheldByConflictId[id] = result.withheldKeys
        summary.withheldFieldTotal += result.withheldKeys.length
      }
    } else if (result.changed) {
      summary.migrated += 1
      if (apply) {
        // Re-check the precondition at write time, not just at read time —
        // see `buildUpdateFilter` for why. If it lost the race, the write is
        // a no-op and the next run picks the document back up.
        await repo.applyPatch(spec.collection, buildUpdateFilter(doc._id, result.patch), result.patch)
      }
    } else if (result.recognised) {
      summary.skippedAlreadyCanonical += 1
    } else {
      summary.unrecognised += 1
    }
  }

  return summary
}

export async function runMigration(apply: boolean): Promise<CollectionSummary[]> {
  const summaries: CollectionSummary[] = []
  for (const spec of MIGRATION_SPECS) {
    summaries.push(await runCollectionMigration(spec, apply))
  }
  return summaries
}

export interface CensusEntry {
  key: string
  count: number
}

export interface CollectionCensus {
  label: string
  fields: CensusEntry[]
}

/** Read-only: distinct top-level key names per collection, with document counts. */
export async function computeCensus(): Promise<CollectionCensus[]> {
  const out: CollectionCensus[] = []
  for (const spec of MIGRATION_SPECS) {
    const fields = await repo.censusCollection(spec.collection)
    out.push({ label: spec.label, fields })
  }
  return out
}

export { MIGRATION_MARKER_ID } from '@/server/repositories/one-off-migration-repo'
export const claimMigrationMarker = repo.claimMigrationMarker
export const getMigrationMarker = repo.getMigrationMarker
export const completeMigrationMarker = repo.completeMigrationMarker
