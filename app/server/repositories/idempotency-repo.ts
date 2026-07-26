import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'

/**
 * Data access for the `idempotency_keys` collection.
 *
 * One document per (scope, key, actor). The unique index is what makes the
 * claim atomic: two concurrent requests race on `insertOne` and exactly one
 * wins (E11000 for the loser). Documents expire via a TTL index so the
 * collection does not grow without bound.
 *
 * See: docs/migration/06-services-and-repositories.md
 */

export interface IdempotencyDoc {
  scope: string
  key: string
  actorId: string
  /** Hash of the request body — a replay with a different body is a conflict. */
  requestHash: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  /** Stored response payload, replayed verbatim on a repeat request. */
  response: unknown | null
  httpStatus: number | null
  dateCreated: number
  expiresAt: Date
}

let indexesReady = false

function collection(): Collection<IdempotencyDoc> {
  return getDb().collection<IdempotencyDoc>('idempotency_keys')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  const col = collection()
  await col.createIndex(
    { scope: 1, key: 1, actorId: 1 },
    { name: 'uniq_idempotency_scope_key_actor', unique: true },
  )
  await col.createIndex({ expiresAt: 1 }, { name: 'ttl_idempotency', expireAfterSeconds: 0 })
  indexesReady = true
}

export async function findRecord(
  scope: string,
  key: string,
  actorId: string,
): Promise<IdempotencyDoc | null> {
  await ensureIndexes()
  return collection().findOne({ scope, key, actorId })
}

/**
 * Try to claim the key. Returns `true` if this caller now owns the operation,
 * `false` if another request already claimed it (duplicate key).
 */
export async function claim(doc: IdempotencyDoc): Promise<boolean> {
  await ensureIndexes()
  try {
    await collection().insertOne(doc)
    return true
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) return false
    throw err
  }
}

/** Store the successful response so subsequent replays return it verbatim. */
export async function complete(
  scope: string,
  key: string,
  actorId: string,
  response: unknown,
  httpStatus: number,
): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(
    { scope, key, actorId },
    { $set: { status: 'COMPLETED', response, httpStatus } },
  )
}

/** Release a claim whose operation failed, so the caller may retry. */
export async function release(scope: string, key: string, actorId: string): Promise<void> {
  await ensureIndexes()
  await collection().deleteOne({ scope, key, actorId, status: 'IN_PROGRESS' })
}
