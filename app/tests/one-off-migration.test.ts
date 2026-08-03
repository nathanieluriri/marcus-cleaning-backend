import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Coverage for the throwaway migration endpoint (server/routes/one-off-migration.ts):
 *  - the summary-building logic extracted into one-off-migration-service.ts
 *    (shared with the CLI script), and
 *  - that a duplicate-key on the marker claim is exactly what produces the
 *    route's 409, mount-level, with no real Mongo connection involved.
 *
 * The repository is mocked throughout — nothing here connects to a real
 * database.
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

interface Fixture {
  docs: Record<string, Array<Record<string, unknown>>>
  marker: { _id: string; startedAt: string; completedAt?: string; summary?: unknown } | null
  applyPatchCalls: Array<{ name: string; filter: Record<string, unknown>; patch: Record<string, unknown> }>
}

const state: Fixture = { docs: {}, marker: null, applyPatchCalls: [] }

vi.mock('@/server/repositories/one-off-migration-repo', () => ({
  MIGRATION_MARKER_ID: 'admin-feature-fields-migration',
  censusCollection: vi.fn(async (name: string) => {
    const counts = new Map<string, number>()
    for (const doc of state.docs[name] ?? []) {
      for (const key of Object.keys(doc)) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].map(([key, count]) => ({ key, count }))
  }),
  getAllDocuments: vi.fn(async (name: string) => state.docs[name] ?? []),
  applyPatch: vi.fn(async (name: string, filter: Record<string, unknown>, patch: Record<string, unknown>) => {
    state.applyPatchCalls.push({ name, filter, patch })
    return true
  }),
  claimMigrationMarker: vi.fn(async (startedAt: string) => {
    if (state.marker) return false
    state.marker = { _id: 'admin-feature-fields-migration', startedAt }
    return true
  }),
  getMigrationMarker: vi.fn(async () => state.marker),
  completeMigrationMarker: vi.fn(async (completedAt: string, summary: unknown) => {
    if (state.marker) {
      state.marker.completedAt = completedAt
      state.marker.summary = summary
    }
  }),
}))

import { Hono } from 'hono'
import type { Env } from '@/server/core/http-env'
import { AppError } from '@/server/core/errors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { oneOffMigration } from '@/server/routes/one-off-migration'
import { computeCensus, runMigration, runCollectionMigration } from '@/server/services/one-off-migration-service'
import * as repo from '@/server/repositories/one-off-migration-repo'

beforeEach(() => {
  state.docs = {}
  state.marker = null
  state.applyPatchCalls = []
  vi.clearAllMocks()
})

describe('one-off-migration-service — runCollectionMigration', () => {
  it('computes summary counts and does not write when apply=false', async () => {
    state.docs.addon_catalog = [
      { _id: '1', display_name: 'Oven Clean' }, // would migrate
      { _id: '2', title: 'Already Clean' }, // already canonical
      { _id: '3', price_minor: 2500, price: 30 }, // conflict
      { _id: '4', some_unrelated_field: 1 }, // unrecognised
    ]

    const { runMigration: runMigrationLocal } = await import('@/server/services/one-off-migration-service')
    const summaries = await runMigrationLocal(false)
    const addonSummary = summaries.find((s) => s.label === 'addon_catalog')!

    expect(addonSummary.scanned).toBe(4)
    expect(addonSummary.migrated).toBe(1)
    expect(addonSummary.skippedAlreadyCanonical).toBe(1)
    expect(addonSummary.conflicting).toBe(1)
    expect(addonSummary.conflictIds).toEqual(['3'])
    expect(addonSummary.unrecognised).toBe(1)
    expect(state.applyPatchCalls).toHaveLength(0)
  })

  it('writes through the repository only when apply=true, using buildUpdateFilter as the precondition', async () => {
    state.docs.addon_catalog = [{ _id: '1', display_name: 'Oven Clean' }]

    const spec = { collection: 'addon_catalog', label: 'addon_catalog', migrate: (await import('@/server/services/admin-feature-migration')).migrateAddOn }
    const summary = await runCollectionMigration(spec, true)

    expect(summary.migrated).toBe(1)
    expect(state.applyPatchCalls).toHaveLength(1)
    expect(state.applyPatchCalls[0]).toEqual({
      name: 'addon_catalog',
      filter: { _id: '1', title: { $exists: false } },
      patch: { title: 'Oven Clean' },
    })
  })

  it('reports base_duration_minutes as flagged-for-review, never migrated', async () => {
    state.docs.service_definitions = [{ _id: '1', base_duration_minutes: 120 }]
    const summaries = await runMigration(false)
    const svc = summaries.find((s) => s.label === 'service_definitions')!
    expect(svc.flaggedForHumanReview).toBe(1)
    expect(svc.flaggedFieldCounts.base_duration_minutes).toBe(1)
    expect(svc.migrated).toBe(0)
  })
})

describe('one-off-migration-service — computeCensus', () => {
  it('reports distinct field names with counts per collection, read-only', async () => {
    state.docs.promo_code = [{ _id: '1', code: 'A' }, { _id: '2', code: 'B', discount_value: 5 }]
    const census = await computeCensus()
    const promo = census.find((c) => c.label === 'promo_code')!
    const byKey = Object.fromEntries(promo.fields.map((f) => [f.key, f.count]))
    expect(byKey.code).toBe(2)
    expect(byKey.discount_value).toBe(1)
    expect(state.applyPatchCalls).toHaveLength(0)
  })
})

function makeApp() {
  const app = new Hono<Env>()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ success: false, code: err.code, details: err.details ?? null }, err.httpStatus as ContentfulStatusCode)
    }
    return c.json({ success: false, code: 'INTERNAL_ERROR', details: String(err) }, 500)
  })
  app.route('/api/v1/one-off-migration', oneOffMigration)
  return app
}

describe('routes: GET /api/v1/one-off-migration/census', () => {
  it('200s with per-collection field counts and calls no write method', async () => {
    state.docs.service_definitions = [{ _id: '1', display_name: 'Deep Clean' }]
    const app = makeApp()
    const res = await app.request('/api/v1/one-off-migration/census')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.collections)).toBe(true)
    expect(repo.applyPatch).not.toHaveBeenCalled()
    expect(repo.claimMigrationMarker).not.toHaveBeenCalled()
    expect(repo.completeMigrationMarker).not.toHaveBeenCalled()
  })
})

describe('routes: GET /api/v1/one-off-migration/status', () => {
  it('reports hasRun=false before any run', async () => {
    const app = makeApp()
    const res = await app.request('/api/v1/one-off-migration/status')
    const body = await res.json()
    expect(body.data.hasRun).toBe(false)
    expect(repo.applyPatch).not.toHaveBeenCalled()
  })

  it('reports the recorded summary after a run', async () => {
    state.marker = { _id: 'admin-feature-fields-migration', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:05.000Z', summary: [{ label: 'x' }] }
    const app = makeApp()
    const res = await app.request('/api/v1/one-off-migration/status')
    const body = await res.json()
    expect(body.data.hasRun).toBe(true)
    expect(body.data.completedAt).toBe('2026-01-01T00:00:05.000Z')
  })
})

describe('routes: POST /api/v1/one-off-migration/apply — run-once guarantee', () => {
  it('claims the marker, runs the migration, and records the summary', async () => {
    state.docs.addon_catalog = [{ _id: '1', display_name: 'Oven Clean' }]
    const app = makeApp()
    const res = await app.request('/api/v1/one-off-migration/apply', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(repo.claimMigrationMarker).toHaveBeenCalledTimes(1)
    expect(repo.completeMigrationMarker).toHaveBeenCalledTimes(1)
    expect(state.marker?.completedAt).toBeDefined()
  })

  it('returns 409 with no migration writes when the marker claim loses the duplicate-key race', async () => {
    // Simulate: the marker is already present (a prior run claimed it, or a
    // concurrent request won the atomic insertOne race first).
    state.marker = { _id: 'admin-feature-fields-migration', startedAt: '2026-01-01T00:00:00.000Z' }
    state.docs.addon_catalog = [{ _id: '1', display_name: 'Oven Clean' }]

    const app = makeApp()
    const res = await app.request('/api/v1/one-off-migration/apply', { method: 'POST' })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CONFLICT')
    expect(body.details.startedAt).toBe('2026-01-01T00:00:00.000Z')
    // No migration write should have happened on the losing path.
    expect(repo.applyPatch).not.toHaveBeenCalled()
    expect(repo.completeMigrationMarker).not.toHaveBeenCalled()
  })

  it('a second POST after a completed run also 409s (true run-once, not just anti-concurrency)', async () => {
    const app = makeApp()
    const first = await app.request('/api/v1/one-off-migration/apply', { method: 'POST' })
    expect(first.status).toBe(200)

    const second = await app.request('/api/v1/one-off-migration/apply', { method: 'POST' })
    expect(second.status).toBe(409)
  })
})
