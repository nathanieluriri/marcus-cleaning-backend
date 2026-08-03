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
 * The actual scan/compute/write orchestration lives in
 * `server/services/one-off-migration-service.ts`, shared with the temporary
 * HTTP endpoint at `server/routes/one-off-migration.ts` — this script and
 * that route can never drift apart on what "the migration" means.
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

import { closeClient } from '@/server/core/mongo'
import {
  computeCensus,
  runMigration,
  type CollectionSummary,
} from '@/server/services/one-off-migration-service'

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
  const collections = await computeCensus()
  for (const { label, fields } of collections) {
    console.log(`${label}:`)
    for (const { key, count } of fields) {
      console.log(`  ${key}: ${count}`)
    }
    console.log('')
  }
  console.log('Compare these key names against the legacy/canonical pairs in')
  console.log('server/services/admin-feature-migration.ts to confirm nothing is unmapped')
  console.log('before running --dry-run and then --apply.')
}

function printSummaries(summaries: CollectionSummary[], apply: boolean): void {
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

async function runMigrationCli(apply: boolean): Promise<void> {
  console.log(apply ? 'Running in APPLY mode — documents will be written.' : 'Running in DRY-RUN mode (default) — no documents will be written.')
  const summaries = await runMigration(apply)
  printSummaries(summaries, apply)
}

async function main(): Promise<void> {
  const { apply, census } = parseArgs(process.argv.slice(2))

  if (census) {
    await runCensus()
    return
  }

  await runMigrationCli(apply)
}

main()
  .then(async () => {
    await closeClient()
  })
  .catch(async (err) => {
    console.error(err)
    await closeClient()
    // Use `process.exitCode` + let Node exit naturally, instead of
    // `process.exit`, which can truncate buffered stdout/stderr and skips
    // the client-close path entirely.
    process.exitCode = 1
  })
