import type { Collection, Document } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { fromDoc } from './_helpers'

/**
 * Data access for `role_permission_templates` — per-role permission templates
 * plus rollout metadata. Ported from `role_permission_template_repo.py`.
 * Only this layer touches Mongo.
 *
 * See: docs/migration/02-data-model.md, docs/migration/06-services-and-repositories.md
 */

let indexesReady = false

function collection(): Collection<Document> {
  return getDb().collection<Document>('role_permission_templates')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ role: 1 }, { name: 'idx_role_permission_template_role', unique: true })
  indexesReady = true
}

export async function getByRole(role: string): Promise<Record<string, unknown> | null> {
  await ensureIndexes()
  const row = await collection().findOne({ role })
  return row ? fromDoc(row) : null
}

/** Upsert the template for a role, returning the stored document. */
export async function upsertForRole(
  role: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureIndexes()
  const ts = Math.floor(Date.now() / 1000)
  const { id: _ignore, role: _ignoreRole, ...rest } = data
  void _ignore
  void _ignoreRole
  await collection().updateOne(
    { role },
    {
      $set: { ...rest, role, lastUpdated: ts },
      $setOnInsert: { dateCreated: ts },
    },
    { upsert: true },
  )
  const stored = await collection().findOne({ role })
  return fromDoc(stored)
}

/** Record a rollout marker on the role template (rollout = apply template to existing accounts). */
export async function markRollout(
  role: string,
  meta: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  await ensureIndexes()
  await collection().updateOne(
    { role },
    { $set: { lastRollout: { ...meta, at: Math.floor(Date.now() / 1000) }, lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return getByRole(role)
}
