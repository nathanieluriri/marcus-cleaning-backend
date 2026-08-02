/**
 * One-off runner: repairs admin-feature documents that still carry legacy
 * field names (see `server/services/admin-feature-migration.ts` for why).
 *
 * SAFETY: this script is dry-run by default. It reuses the module-cached
 * Mongo client from `server/core/mongo.ts` (never a second `MongoClient`,
 * per `CLAUDE.md`), reads every document in the three affected collections,
 * computes what WOULD change, and only WRITES anything if the process was
 * invoked with the explicit `--apply` flag. No flag, a typo'd flag, or
 * `--dry-run` all fall through to the read-only path.
 *
 * INTENDED ORDER OF OPERATIONS:
 *   1. `--census`   read-only. Reports every distinct top-level key seen in
 *                   each collection, with counts. Run this FIRST to confirm
 *                   the mapping table in admin-feature-migration.ts actually
 *                   covers every legacy key present in the real data — no
 *                   test suite can prove that; only the data can.
 *   2. (default) / `--dry-run`
 *                   read-only. Reports what the migration WOULD do: how many
 *                   docs would change, how many are already canonical, how
 *                   many have a genuine legacy/canonical conflict (logged by
 *                   _id), and how many matched no rule at all.
 *   3. `--apply`    writes the computed patches.
 *
 * Usage:
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts             # dry run (default)
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts --dry-run   # dry run (explicit)
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts --census    # read-only key census
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts --apply     # writes patches
 */

import { getDb } from '@/server/core/mongo'
import {
  migrateAddOn,
  migratePromoCode,
  migrateServiceDefinition,
  type MigrationResult,
} from '@/server/services/admin-feature-migration'

interface CollectionSpec {
  collection: string
  label: string
  migrate: (doc: Record<string, unknown>) => MigrationResult
}

const SPECS: CollectionSpec[] = [
  { collection: 'service_definitions', label: 'service_definitions', migrate: migrateServiceDefinition },
  { collection: 'addon_catalog', label: 'addon_catalog', migrate: migrateAddOn },
  { collection: 'promo_code', label: 'promo_code', migrate: migratePromoCode },
]

interface CollectionSummary {
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

/**
 * `apply: false` (the default) never calls `updateOne` — it only computes
 * and returns the summary, which is the whole of the dry-run guarantee.
 */
async function runCollection(spec: CollectionSpec, apply: boolean): Promise<CollectionSummary> {
  const db = getDb()
  const coll = db.collection(spec.collection)
  const cursor = coll.find({})

  const summary: CollectionSummary = {
    label: spec.label,
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

  for await (const doc of cursor) {
    summary.scanned += 1
    const result = spec.migrate(doc as Record<string, unknown>)

    if (result.invalid.length > 0) summary.invalid += 1
    if (result.flagged.length > 0) {
      summary.flaggedForHumanReview += 1
      for (const field of result.flagged) {
        summary.flaggedFieldCounts[field] = (summary.flaggedFieldCounts[field] ?? 0) + 1
      }
    }

    // Priority mirrors "stop being silent about it" (Finding 5): a real
    // contradiction is always surfaced, even if some other field on the
    // same doc would also migrate cleanly.
    if (result.conflicts.length > 0) {
      summary.conflicting += 1
      const id = String((doc as Record<string, unknown>)._id)
      summary.conflictIds.push(id)
      if (result.withheldKeys.length > 0) {
        summary.withheldByConflictId[id] = result.withheldKeys
        summary.withheldFieldTotal += result.withheldKeys.length
      }
    } else if (result.changed) {
      summary.migrated += 1
      if (apply) {
        await coll.updateOne({ _id: doc._id }, { $set: result.patch })
      }
    } else if (result.recognised) {
      summary.skippedAlreadyCanonical += 1
    } else {
      summary.unrecognised += 1
    }
  }

  return summary
}

/** Read-only: distinct top-level key names per collection, with document counts. */
async function censusCollection(spec: CollectionSpec): Promise<Map<string, number>> {
  const db = getDb()
  const coll = db.collection(spec.collection)
  const cursor = coll.find({})
  const counts = new Map<string, number>()

  for await (const doc of cursor) {
    for (const key of Object.keys(doc as Record<string, unknown>)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return counts
}

function parseArgs(argv: string[]): { apply: boolean; census: boolean } {
  // Default is dry-run. Only the exact, explicit `--apply` flag switches to
  // writing — any other/unknown flag (including a mistyped `--aply`) leaves
  // `apply` false and the script stays read-only. `--census` is likewise
  // read-only and takes priority over apply/dry-run if both are somehow passed.
  const apply = argv.includes('--apply')
  const census = argv.includes('--census')
  return { apply, census }
}

async function runCensus(): Promise<void> {
  console.log('Running in CENSUS mode (read-only) — reporting distinct top-level keys per collection.\n')
  for (const spec of SPECS) {
    const counts = await censusCollection(spec)
    console.log(`${spec.label}:`)
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    for (const [key, count] of sorted) {
      console.log(`  ${key}: ${count}`)
    }
    console.log('')
  }
  console.log('Compare these key names against the legacy/canonical pairs in')
  console.log('server/services/admin-feature-migration.ts to confirm nothing is unmapped')
  console.log('before running --dry-run and then --apply.')
}

async function runMigration(apply: boolean): Promise<void> {
  console.log(apply ? 'Running in APPLY mode — documents will be written.' : 'Running in DRY-RUN mode (default) — no documents will be written.')

  const summaries: CollectionSummary[] = []
  for (const spec of SPECS) {
    summaries.push(await runCollection(spec, apply))
  }

  console.log('\nSummary:')
  for (const s of summaries) {
    console.log(
      `  ${s.label}: scanned=${s.scanned} ${apply ? 'migrated' : 'would-migrate'}=${s.migrated} ` +
        `skipped-already-canonical=${s.skippedAlreadyCanonical} conflicting=${s.conflicting} ` +
        `unrecognised=${s.unrecognised} invalid=${s.invalid}`,
    )
    if (s.conflictIds.length > 0) {
      console.log(`    conflicting _ids: ${s.conflictIds.join(', ')}`)
    }
    if (s.withheldFieldTotal > 0) {
      console.log(
        `    conflicting: ${s.conflicting} documents, withholding ${s.withheldFieldTotal} clean field migrations`,
      )
      for (const [id, keys] of Object.entries(s.withheldByConflictId)) {
        console.log(`      ${id}: withheld ${keys.join(', ')} (resolve the conflict, then re-run — idempotent)`)
      }
    }
    if (s.flaggedForHumanReview > 0) {
      const fields = Object.entries(s.flaggedFieldCounts)
        .map(([field, count]) => `${field}=${count}`)
        .join(', ')
      console.log(`    needs human decision — not migrated (${s.flaggedForHumanReview} docs): ${fields}`)
    }
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write these patches.')
  }
  console.log(
    '\nNote: documents listed under "conflicting" are written to on neither dry-run nor --apply.',
    'Resolve each conflict by hand (the canonical value always wins automatically; edit it if the legacy',
    'value was actually correct), then re-run --apply — the migration is idempotent, so it will pick up',
    'exactly the previously-withheld clean fields for those documents and change nothing else.',
  )
}

async function main(): Promise<void> {
  const { apply, census } = parseArgs(process.argv.slice(2))

  if (census) {
    await runCensus()
    return
  }

  await runMigration(apply)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
