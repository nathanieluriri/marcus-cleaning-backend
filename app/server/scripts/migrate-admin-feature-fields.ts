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
 * Usage:
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts            # dry run (default)
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts --dry-run  # dry run (explicit)
 *   npx tsx server/scripts/migrate-admin-feature-fields.ts --apply    # writes patches
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
  changed: number
  skippedAlreadyCanonical: number
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
    changed: 0,
    skippedAlreadyCanonical: 0,
  }

  for await (const doc of cursor) {
    summary.scanned += 1
    const { changed, patch } = spec.migrate(doc as Record<string, unknown>)

    if (!changed) {
      summary.skippedAlreadyCanonical += 1
      continue
    }

    summary.changed += 1

    if (apply) {
      await coll.updateOne({ _id: doc._id }, { $set: patch })
    }
  }

  return summary
}

function parseArgs(argv: string[]): { apply: boolean } {
  // Default is dry-run. Only the exact, explicit `--apply` flag switches to
  // writing — any other/unknown flag (including a mistyped `--aply`) leaves
  // `apply` false and the script stays read-only.
  const apply = argv.includes('--apply')
  return { apply }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2))

  console.log(apply ? 'Running in APPLY mode — documents will be written.' : 'Running in DRY-RUN mode (default) — no documents will be written.')

  const summaries: CollectionSummary[] = []
  for (const spec of SPECS) {
    summaries.push(await runCollection(spec, apply))
  }

  console.log('\nSummary:')
  for (const s of summaries) {
    console.log(
      `  ${s.label}: scanned=${s.scanned} ${apply ? 'changed' : 'would-change'}=${s.changed} skipped-already-canonical=${s.skippedAlreadyCanonical}`,
    )
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write these patches.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
