import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter } from './_helpers'

/**
 * `admin_otp_challenges` — short-lived login 2FA challenges. One doc per
 * login attempt; consumed (or locked after 5 bad attempts) then left for
 * Mongo TTL to reap. See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 */

export interface AdminOtpChallengeDoc {
  adminId: string
  /** sha256 of the emailed code. Null for method 'totp' — verification is live, nothing to store. */
  codeHash: string | null
  method: 'email' | 'totp'
  attempts: number
  /** epoch seconds */
  expiresAt: number
  consumedAt?: number | null
  dateCreated: number
}

let indexesReady = false

function collection(): Collection<AdminOtpChallengeDoc> {
  return getDb().collection<AdminOtpChallengeDoc>('admin_otp_challenges')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ adminId: 1 }, { name: 'idx_otp_challenge_admin' })
  indexesReady = true
}

export async function insertChallenge(doc: AdminOtpChallengeDoc): Promise<WithId<AdminOtpChallengeDoc>> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function findById(id: string): Promise<WithId<AdminOtpChallengeDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

/** Atomically bump the attempt counter and return the new count. */
export async function incrementAttempts(id: string): Promise<number> {
  await ensureIndexes()
  const result = await collection().findOneAndUpdate(
    idFilter(id),
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )
  return result?.attempts ?? 0
}

export async function markConsumed(id: string, atEpochSeconds: number): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), { $set: { consumedAt: atEpochSeconds } })
}
