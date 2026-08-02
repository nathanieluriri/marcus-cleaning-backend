import { MongoClient, ServerApiVersion, type Db } from 'mongodb'
import { getSettings } from './settings'

/**
 * Serverless-safe MongoDB client.
 *
 * The client (and its connection pool) is cached at module scope so it is
 * reused across warm invocations. Re-instantiating per request exhausts Atlas
 * connection limits. Node.js runtime only — never Edge.
 *
 * See: ../../../docs/migration/02-data-model.md
 */

const g = global as typeof globalThis & { _mongoClient?: MongoClient }

function buildClient(): MongoClient {
  const { MONGODB_URI } = getSettings()
  return new MongoClient(MONGODB_URI, {
    appName: 'marcus-backend',
    maxPoolSize: 10, // serverless: keep small (driver default of 100 is too high)
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    serverApi: { version: ServerApiVersion.v1 },
  })
}

function getClient(): MongoClient {
  if (process.env.NODE_ENV === 'development') {
    // Preserve the client across HMR module reloads in dev.
    if (!g._mongoClient) g._mongoClient = buildClient()
    return g._mongoClient
  }
  if (!g._mongoClient) g._mongoClient = buildClient()
  return g._mongoClient
}

export function getDb(): Db {
  return getClient().db(getSettings().DB_NAME)
}

/**
 * Closes the cached client and clears the module-scope reference, so a
 * one-off script (e.g. `server/scripts/migrate-admin-feature-fields.ts`) can
 * exit cleanly instead of leaving the process alive on an open socket. Safe
 * to call even if the client was never built.
 */
export async function closeClient(): Promise<void> {
  if (!g._mongoClient) return
  const client = g._mongoClient
  g._mongoClient = undefined
  await client.close()
}

export { getClient }
