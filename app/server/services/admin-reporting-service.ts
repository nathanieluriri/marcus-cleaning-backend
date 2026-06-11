/**
 * Admin reporting: user summary + signups trend.
 * Ported from `admin_reporting_service.py`. No Hono/HTTP types here.
 *
 * These count real documents in `customers`/`cleaners` where cheap, and return
 * well-shaped stubs for the trend aggregation (await exact bucketing logic).
 * See: docs/migration/06-services-and-repositories.md
 */

import { getDb } from '@/server/core/mongo'

export async function usersSummary(): Promise<Record<string, unknown>> {
  const db = getDb()
  const [customers, cleaners, admins] = await Promise.all([
    db.collection('customers').estimatedDocumentCount(),
    db.collection('cleaners').estimatedDocumentCount(),
    db.collection('admins').estimatedDocumentCount(),
  ])
  // TODO: real implementation — break down by accountStatus and active windows.
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    totals: { customers, cleaners, admins, all: customers + cleaners + admins },
  }
}

export async function signupsTrend(): Promise<Record<string, unknown>> {
  // TODO: real implementation — group customers/cleaners by signup day over the
  // requested window. Returning a well-shaped empty series for now.
  return { series: [], range: { from: null, to: null } }
}
