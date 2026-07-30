import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { sha256 } from '@/server/security/hash'
import type { Role } from '@/server/security/principal'

/**
 * Single-use, time-boxed password-reset tokens. Mongo TTL purges expired docs
 * automatically (index on `expiresAt` with expireAfterSeconds: 0). Only the
 * sha256 hash of the token is stored — the plaintext lives only in the email.
 * Mirrors the sessions / oauth_states TTL pattern. See spec §5.1.1.
 *
 * `role` is stored alongside the account id so a token issued for one role
 * (e.g. customer) can never be used to reset an account of another role
 * (e.g. cleaner) — checked on consume.
 */

interface ResetTokenDoc {
  accountId: string
  role: Role
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

/** Store a reset token (hashed) for an account of the given role. */
export async function issue(args: { accountId: string; role: Role; token: string; expiresAt: Date }): Promise<void> {
  await ensureIndexes()
  await collection().insertOne({
    accountId: args.accountId,
    role: args.role,
    tokenHash: sha256(args.token),
    expiresAt: args.expiresAt,
    createdAt: new Date(),
  })
}

/**
 * Consume a token: if a non-expired match for the expected role exists,
 * delete it and return the account id; otherwise return null. Single-use
 * (deleteOne on match). The role check prevents a token issued for one role
 * (e.g. customer) from resetting an account of another role (e.g. cleaner).
 */
export async function consume(token: string, role: Role): Promise<string | null> {
  await ensureIndexes()
  const doc = await collection().findOneAndDelete({
    tokenHash: sha256(token),
    role,
    expiresAt: { $gt: new Date() },
  })
  return doc?.accountId ?? null
}
