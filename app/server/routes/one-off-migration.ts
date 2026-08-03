/* ============================================================================
 * TEMPORARY, THROWAWAY ENDPOINT — DELETE AFTER ONE USE
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ----------------
 * The repo owner needs to run the already-written, already-tested admin-
 * feature-field migration (see `server/services/admin-feature-migration.ts`
 * and `server/scripts/migrate-admin-feature-fields.ts`), but the app runs on
 * Vercel (serverless — no shell access) and the owner does not have the
 * MongoDB connection string available locally to run the script directly.
 * They explicitly asked for an ungated HTTP endpoint they can hit with
 * `curl` from wherever they are, on the explicit understanding that:
 *   - this is a hobby project with no live users right now,
 *   - this endpoint will be deleted immediately after use.
 * That decision belongs to the owner, not to this code. What follows makes
 * it as safe as possible WITHOUT adding gates they declined (no auth, no
 * secret header) — the safety instead comes from what the endpoints can and
 * cannot do.
 *
 * THIS IS INTENTIONALLY UNAUTHENTICATED. Do not add `requireAdmin()` or any
 * other guard here — that was a deliberate, explicit choice by the owner.
 *
 * WHAT MAKES THIS SAFE
 * ---------------------
 *  - `GET /census` and `GET /status` are provably read-only — see the
 *    doc-comments on each handler for how to verify that by inspection.
 *  - `POST /apply` runs EXACTLY ONCE, ever, enforced by an ATOMIC
 *    `insertOne` on a marker document with a FIXED `_id`
 *    (`one-off-migration-repo.ts` -> `MIGRATION_MARKER_ID`). A second
 *    invocation — including two concurrent invocations racing each other —
 *    hits a duplicate-key error at the database level and returns 409. This
 *    is a real compare-and-set, not a "find, then insert if absent" check
 *    (which two concurrent curls could both pass).
 *  - All migration logic is reused, not reimplemented: this route calls the
 *    exact same `runMigration` / `computeCensus` functions the tested CLI
 *    script uses (`server/services/one-off-migration-service.ts`), which in
 *    turn call the pure, unit-tested field-mapping functions in
 *    `admin-feature-migration.ts`. The never-clobber write precondition
 *    (`buildUpdateFilter`) is identical to the script's.
 *
 * HOW TO REMOVE THIS ENDPOINT ONCE USED
 * --------------------------------------
 *   1. Delete this file (`server/routes/one-off-migration.ts`).
 *   2. Delete the three `app.route('/api/v1/one-off-migration', ...)` /
 *      import lines for it in `server/app.ts`.
 *   3. Redeploy.
 *   (Optionally also drop the `_one_off_migration_runs` collection and the
 *   `claude/one-off-migration-endpoint` branch — neither is required for
 *   correctness, just tidiness.)
 * ==========================================================================*/

import { createRouter } from '@/server/core/router'
import { ok } from '@/server/core/envelope'
import { conflict } from '@/server/core/errors'
import {
  claimMigrationMarker,
  completeMigrationMarker,
  computeCensus,
  getMigrationMarker,
  runMigration,
} from '@/server/services/one-off-migration-service'

export const oneOffMigration = createRouter()

/**
 * GET /census — READ-ONLY, repeatable.
 *
 * Verify by inspection: the only service call here is `computeCensus()`,
 * which (in `one-off-migration-service.ts`) calls only
 * `repo.censusCollection`, which (in `one-off-migration-repo.ts`) runs a
 * single `$aggregate` pipeline built entirely from `$project` / `$unwind` /
 * `$group` / `$sort` stages — none of which write. No `insertOne`,
 * `updateOne`, `deleteOne`, `insertMany`, `updateMany`, `deleteMany`,
 * `findOneAndUpdate`, `findOneAndDelete`, `replaceOne`, or `bulkWrite`
 * appears anywhere on this request path.
 */
oneOffMigration.get('/census', async (c) => {
  const collections = await computeCensus()
  return c.json(ok(c, 'Census computed', { collections }), 200)
})

/**
 * GET /status — READ-ONLY.
 *
 * Verify by inspection: the only service call here is `getMigrationMarker()`,
 * which (in `one-off-migration-repo.ts`) is a single `findOne`. No write
 * method appears anywhere on this request path. Use this to check whether
 * `POST /apply` has already run — and with what result — without any risk.
 */
oneOffMigration.get('/status', async (c) => {
  const marker = await getMigrationMarker()
  if (!marker) {
    return c.json(ok(c, 'Migration has not run yet', { hasRun: false }), 200)
  }
  return c.json(
    ok(c, marker.completedAt ? 'Migration already completed' : 'Migration is in progress or crashed mid-run', {
      hasRun: true,
      startedAt: marker.startedAt,
      completedAt: marker.completedAt ?? null,
      summary: marker.summary ?? null,
    }),
    200,
  )
})

/**
 * POST /apply — runs the migration, EXACTLY ONCE, EVER.
 *
 * Run-once guarantee: `claimMigrationMarker` performs an `insertOne` with a
 * FIXED `_id` (`MIGRATION_MARKER_ID`) BEFORE any migration writes happen. If
 * that insert hits a duplicate key (the marker already exists — from a prior
 * run, or from a concurrent request that won the race), this returns 409
 * immediately and no migration write is attempted. Only the caller that
 * successfully claims the marker proceeds to run the migration.
 */
oneOffMigration.post('/apply', async (c) => {
  const startedAt = new Date().toISOString()
  const claimed = await claimMigrationMarker(startedAt)

  if (!claimed) {
    const existing = await getMigrationMarker()
    const when = existing?.startedAt ?? 'an earlier time'
    throw conflict(
      `The migration has already run (started ${when}). This endpoint runs at most once. ` +
        'Call GET /api/v1/one-off-migration/status to see the recorded summary.',
      { startedAt: existing?.startedAt ?? null, completedAt: existing?.completedAt ?? null },
    )
  }

  const summaries = await runMigration(true)
  const completedAt = new Date().toISOString()
  await completeMigrationMarker(completedAt, summaries)

  return c.json(ok(c, 'Migration applied', { startedAt, completedAt, collections: summaries }), 200)
})
