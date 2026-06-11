import { createRoute } from '@hono/zod-openapi'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { BroadcastDispatch, FeatureOut } from '@/server/schemas/admin-features'
import { crudRouter } from './_crud'
import * as repo from '@/server/repositories/admin-features/_generic-repo'

/**
 * /broadcasts — CRUD over `system_broadcast` plus:
 *   POST `/dispatch` — dispatch a broadcast.
 *
 * Dispatch was a Celery enqueue; target is inline/`waitUntil` send (small fan-out)
 * or batch. Here we record the dispatch intent and mark it dispatched.
 * TODO: wire to the real fan-out/email path (see docs/migration/10-background-and-cron.md).
 * See: docs/migration/07-domain-endpoints.md
 */

const COLL = 'system_broadcast'
const TAG = 'Broadcasts'

export const broadcasts = crudRouter({ collection: COLL, tag: TAG, noun: 'broadcast' })

broadcasts.use('/dispatch', requireAdmin())
broadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/dispatch',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: BroadcastDispatch } } } },
    responses: {
      201: { description: 'Broadcast dispatched', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const body = c.req.valid('json') as Record<string, unknown>
    const ts = Math.floor(Date.now() / 1000)
    const record = await repo.insertRaw(COLL, {
      ...body,
      status: 'DISPATCHED',
      dispatchedBy: p.userId,
      dispatchedAt: ts,
      dateCreated: ts,
      lastUpdated: ts,
    })
    return c.json(ok(c, 'Broadcast dispatched', FeatureOut.parse(record)), 201)
  },
)
