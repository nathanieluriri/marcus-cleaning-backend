import { randomBytes } from 'node:crypto'
import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'

/**
 * `admin_otp_challenges` — short-lived login 2FA challenges. One doc per
 * login attempt; consumed (or locked after too many bad attempts) then left
 * for Mongo TTL to reap. See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 *
 * Looked up by an opaque `challengeId` (random, non-enumerable) rather than
 * the Mongo `_id` — an ObjectId embeds a creation timestamp and an
 * auto-incrementing counter, which makes it guessable/enumerable and unfit
 * to hand to an unauthenticated client as a bearer-style lookup key.
 */

export interface AdminOtpChallengeDoc {
  challengeId: string
  adminId: string
  /** sha256 of the emailed code. Null for method 'totp' — verification is live, nothing to store. */
  codeHash: string | null
  method: 'email' | 'totp'
  attempts: number
  /** epoch seconds — the service's clock arithmetic works in epoch seconds throughout. */
  expiresAt: number
  /** same instant as `expiresAt`, stored as a Date so Mongo's TTL monitor can reap it. */
  expiresAtDate: Date
  consumedAt?: number | null
  dateCreated: number
}

let indexesReady = false

function collection(): Collection<AdminOtpChallengeDoc> {
  return getDb().collection<AdminOtpChallengeDoc>('admin_otp_challenges')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ challengeId: 1 }, { name: 'idx_otp_challenge_id', unique: true })
  await collection().createIndex({ adminId: 1 }, { name: 'idx_otp_challenge_admin' })
  await collection().createIndex(
    { expiresAtDate: 1 },
    { name: 'idx_otp_challenge_ttl', expireAfterSeconds: 0 },
  )
  indexesReady = true
}

/** Opaque, high-entropy, non-guessable challenge id (192 bits). */
export function generateChallengeId(): string {
  return randomBytes(24).toString('base64url')
}

export async function insertChallenge(
  doc: Omit<AdminOtpChallengeDoc, 'expiresAtDate'>,
): Promise<WithId<AdminOtpChallengeDoc>> {
  await ensureIndexes()
  const full: AdminOtpChallengeDoc = { ...doc, expiresAtDate: new Date(doc.expiresAt * 1000) }
  const result = await collection().insertOne(full)
  return { ...full, _id: result.insertedId }
}

export async function findByChallengeId(challengeId: string): Promise<WithId<AdminOtpChallengeDoc> | null> {
  await ensureIndexes()
  return collection().findOne({ challengeId })
}

/**
 * Atomic check-and-increment: only bumps `attempts` while it's still under
 * `maxAttempts`, and returns the post-increment doc. A null result means the
 * challenge was already at (or past) the limit — the caller should treat
 * that as locked WITHOUT verifying `code` against anything, closing the race
 * where concurrent guesses could all read a stale attempts count and slip
 * past a check-then-write gate.
 */
export async function incrementAttemptsIfUnderLimit(
  challengeId: string,
  maxAttempts: number,
): Promise<WithId<AdminOtpChallengeDoc> | null> {
  await ensureIndexes()
  return collection().findOneAndUpdate(
    { challengeId, attempts: { $lt: maxAttempts } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )
}

export async function markConsumed(challengeId: string, atEpochSeconds: number): Promise<void> {
  await ensureIndexes()
  await collection().updateOne({ challengeId }, { $set: { consumedAt: atEpochSeconds } })
}
