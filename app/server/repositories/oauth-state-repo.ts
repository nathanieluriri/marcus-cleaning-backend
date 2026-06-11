import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import type { Role } from '@/server/security/principal'

/**
 * Short-lived Google OAuth CSRF/PKCE state (`oauth_states` collection).
 *
 * Each pending authorization stores the random `state` (CSRF token) and the
 * PKCE `codeVerifier`. A TTL index on `expiresAt` auto-cleans abandoned flows
 * (~10 min). `consume` is a find-and-delete so a state can be used exactly once.
 *
 * See: docs/migration/03-auth.md (Google OAuth), 02-data-model.md
 */

export interface OAuthStateDoc {
  state: string
  codeVerifier: string
  role: Role
  createdAt: Date
  expiresAt: Date
}

let indexesReady = false

function collection(): Collection<OAuthStateDoc> {
  return getDb().collection<OAuthStateDoc>('oauth_states')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ state: 1 }, { name: 'idx_oauth_state', unique: true })
  // TTL: auto-delete abandoned flows once expiresAt passes (~10 min after creation).
  await collection().createIndex({ expiresAt: 1 }, { name: 'idx_oauth_state_ttl', expireAfterSeconds: 0 })
  indexesReady = true
}

export async function insert(doc: OAuthStateDoc): Promise<void> {
  await ensureIndexes()
  await collection().insertOne(doc)
}

/** Find the state and delete it atomically — single-use. Returns null if unknown/expired. */
export async function consume(state: string): Promise<OAuthStateDoc | null> {
  await ensureIndexes()
  const doc = await collection().findOneAndDelete({ state })
  if (!doc) return null
  // Belt-and-suspenders: TTL sweep can lag, so reject expired states explicitly.
  if (doc.expiresAt.getTime() < Date.now()) return null
  return doc
}
