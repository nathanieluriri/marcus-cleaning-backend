import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { AdminOut, type AdminDoc, type AdminOut as AdminOutType } from '@/server/schemas/admin'
import { idFilter, fromDoc } from './_helpers'

/** Data access for the `admins` collection. Ported from `repositories/admin_repo.py`. */

let indexesReady = false

function collection(): Collection<AdminDoc> {
  return getDb().collection<AdminDoc>('admins')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ email: 1 }, { name: 'idx_admin_email', unique: true })
  indexesReady = true
}

export async function findByEmail(email: string): Promise<WithId<AdminDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ email: email.toLowerCase() })
}

export async function findById(id: string): Promise<WithId<AdminDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function insertAdmin(doc: AdminDoc): Promise<AdminOutType> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  return toAdminOut(stored)
}

export async function updateLastAuthAt(id: string, epochSeconds: number): Promise<void> {
  await collection().updateOne(idFilter(id), { $set: { lastAuthAt: epochSeconds, lastUpdated: epochSeconds } })
}

/** Set a new bcrypt password hash for an admin. */
export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { password: passwordHash, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}

/** Patch arbitrary admin fields (e.g. TOTP state, access preset, mustChangePassword). */
export async function updateAdmin(id: string, patch: Partial<AdminDoc>): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { ...patch, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}

/**
 * Atomically remove one backup-code hash from `backupCodes`. `$pull` is used
 * (rather than read-modify-write of the full array) so two concurrent
 * requests racing to consume the same single-use code can't both succeed.
 * Returns whether the hash was actually present and removed.
 */
export async function consumeBackupCode(id: string, hash: string): Promise<boolean> {
  await ensureIndexes()
  const result = await collection().updateOne(idFilter(id), {
    $pull: { backupCodes: hash },
    $set: { lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return result.modifiedCount > 0
}

const clamp = (n: number | undefined, def: number) => Math.min(Math.max(n ?? def, 1), 500)

export interface ListAdminsResult {
  items: WithId<AdminDoc>[]
  total: number
}

/** Paginated listing of admins, most recently created first. */
export async function listAdmins(opts: { limit?: number; skip?: number } = {}): Promise<ListAdminsResult> {
  await ensureIndexes()
  const limit = clamp(opts.limit, 50)
  const skip = Math.max(opts.skip ?? 0, 0)
  const [items, total] = await Promise.all([
    collection().find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    collection().countDocuments({}),
  ])
  return { items, total }
}

/** Count of active super-admin accounts — used to block demoting/removing the last one. */
export async function countSuperAdmins(): Promise<number> {
  await ensureIndexes()
  return collection().countDocuments({ isSuperAdmin: true })
}

export function toAdminOut(doc: unknown): AdminOutType {
  const plain = fromDoc(doc) as Record<string, unknown>
  const totpEnabledAt = plain.totpEnabledAt
  return AdminOut.parse({ ...plain, totpEnabled: totpEnabledAt != null })
}
