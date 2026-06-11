import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { sha256 } from '@/server/security/hash'

/**
 * Single-use, time-boxed password-reset tokens. Mongo TTL purges expired docs
 * automatically (index on `expiresAt` with expireAfterSeconds: 0). Only the
 * sha256 hash of the token is stored — the plaintext lives only in the email.
 * Mirrors the sessions / oauth_states TTL pattern. See spec §5.1.1.
 */

interface ResetTokenDoc {
  customerId: string
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

let indexesReady = false

function collection(): Collection<ResetTokenDoc> {
  return getDb().collection<ResetTokenDoc>('password_reset_tokens')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ tokenHash: 1 }, { name: 'idx_reset_token_hash', unique: true })
  await collection().createIndex({ expiresAt: 1 }, { name: 'idx_reset_token_ttl', expireAfterSeconds: 0 })
  indexesReady = true
}

/** Store a reset token (hashed) for a customer. */
export async function issue(args: { customerId: string; token: string; expiresAt: Date }): Promise<void> {
  await ensureIndexes()
  await collection().insertOne({
    customerId: args.customerId,
    tokenHash: sha256(args.token),
    expiresAt: args.expiresAt,
    createdAt: new Date(),
  })
}

/**
 * Consume a token: if a non-expired match exists, delete it and return the
 * customer id; otherwise return null. Single-use (deleteOne on match).
 */
export async function consume(token: string): Promise<string | null> {
  await ensureIndexes()
  const doc = await collection().findOneAndDelete({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  })
  return doc?.customerId ?? null
}
