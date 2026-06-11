import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import type { Audience, Role } from '@/server/security/principal'

/**
 * Refresh-token families (the `sessions` collection).
 * Replaces the legacy `tokens_repo` access/refresh token collections.
 *
 * Stores only the sha256 hash of each refresh token; supports rotation and
 * reuse detection. A TTL index on `expiresAt` auto-cleans expired sessions.
 * See: docs/migration/03-auth.md
 */

export interface SessionDoc {
  userId: string
  role: Role
  sessionId: string
  tokenHash: string
  audience: Audience
  deviceInfo: { userAgent: string | null; ip: string | null }
  familyIssuedAt: Date
  issuedAt: Date
  lastUsedAt: Date
  expiresAt: Date
  usedAt: Date | null
  replacedBy: string | null
  revokedAt: Date | null
  revocationReason?: string | null
}

let indexesReady = false

function collection(): Collection<SessionDoc> {
  return getDb().collection<SessionDoc>('sessions')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ tokenHash: 1 }, { name: 'idx_session_token_hash', unique: true })
  await collection().createIndex({ userId: 1 }, { name: 'idx_session_user_id' })
  await collection().createIndex({ sessionId: 1 }, { name: 'idx_session_session_id' })
  // TTL: auto-delete sessions once expiresAt passes. Validation still re-checks expiry.
  await collection().createIndex({ expiresAt: 1 }, { name: 'idx_session_ttl', expireAfterSeconds: 0 })
  indexesReady = true
}

export async function insertSession(doc: SessionDoc): Promise<void> {
  await ensureIndexes()
  await collection().insertOne(doc)
}

export async function findByTokenHash(tokenHash: string): Promise<SessionDoc | null> {
  await ensureIndexes()
  return collection().findOne({ tokenHash })
}

export async function markConsumed(tokenHash: string, replacedBy: string, usedAt: Date): Promise<void> {
  await collection().updateOne({ tokenHash }, { $set: { usedAt, replacedBy, lastUsedAt: usedAt } })
}

export async function revokeFamily(sessionId: string, reason: string, at: Date): Promise<number> {
  const res = await collection().updateMany(
    { sessionId, revokedAt: null },
    { $set: { revokedAt: at, revocationReason: reason } },
  )
  return res.modifiedCount
}

export async function revokeAllForUser(userId: string, at: Date, exceptSessionId?: string): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null }
  if (exceptSessionId) filter.sessionId = { $ne: exceptSessionId }
  const res = await collection().updateMany(filter, { $set: { revokedAt: at, revocationReason: 'user-revoke' } })
  return res.modifiedCount
}

export async function revokeSession(userId: string, sessionId: string, at: Date): Promise<number> {
  const res = await collection().updateMany(
    { userId, sessionId, revokedAt: null },
    { $set: { revokedAt: at, revocationReason: 'logout' } },
  )
  return res.modifiedCount
}

export async function listActiveSessions(userId: string): Promise<SessionDoc[]> {
  await ensureIndexes()
  const now = new Date()
  return collection()
    .find({ userId, revokedAt: null, expiresAt: { $gt: now } })
    .sort({ lastUsedAt: -1 })
    .toArray()
}
