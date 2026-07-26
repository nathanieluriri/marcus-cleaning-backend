import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import {
  AudiencePreviewOut,
  BroadcastAudience,
  BroadcastCreateRequest,
  BroadcastListOut,
  BroadcastOut,
} from '@/server/schemas/broadcast'
import { PayoutOut } from '@/server/schemas/earnings'
import { knownNotificationTypes } from '@/server/services/notification-routing'
import * as broadcastService from '@/server/services/broadcast-service'
import * as earningsService from '@/server/services/earnings-service'

/**
 * /v1/admins — broadcast composition/dispatch and payout settlement.
 *
 * Mounted under /api/v1/admins. The legacy `/broadcasts` CRUD router over
 * `system_broadcast` is left in place for contract parity; these live under
 * `/notifications/broadcasts` and are the ones with real fan-out behind them.
 */

export const adminBroadcasts = createRouter()

const errs = {
  400: { description: 'Bad request', content: { 'application/json': { schema: ErrorEnvelope } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

for (const path of [
  '/notifications/broadcasts',
  '/notifications/broadcasts/*',
  '/notifications/types',
  '/payouts/*',
]) {
  adminBroadcasts.use(path, requireAdmin())
}

// GET /notifications/types — the catalogue the composer picks from
adminBroadcasts.openapi(
  createRoute({
    method: 'get',
    path: '/notifications/types',
    tags: ['Admin Broadcasts'],
    summary: 'Notification types available to a broadcast',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Types',
        content: { 'application/json': { schema: envelopeOf(z.array(z.string())) } },
      },
      401: errs[401],
    },
  }),
  async (c) => c.json(ok(c, 'Notification types fetched successfully', knownNotificationTypes()), 200),
)

// POST /notifications/broadcasts/preview — dry-run recipient count
adminBroadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/broadcasts/preview',
    tags: ['Admin Broadcasts'],
    summary: 'How many users would this audience reach?',
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        type: z
          .string()
          .default('promo.broadcast')
          .openapi({ description: 'Notification type — marketing types report the post-opt-out figure.' }),
      }),
      body: { content: { 'application/json': { schema: BroadcastAudience } } },
    },
    responses: {
      200: { description: 'Audience size', content: { 'application/json': { schema: envelopeOf(AudiencePreviewOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { type } = c.req.valid('query')
    const preview = await broadcastService.previewAudience(c.req.valid('json'), type)
    return c.json(ok(c, 'Audience previewed successfully', preview), 200)
  },
)

// POST /notifications/broadcasts — create, queue, and send the first batch
adminBroadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/broadcasts',
    tags: ['Admin Broadcasts'],
    summary: 'Send a notification to a segment of users',
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: BroadcastCreateRequest } } } },
    responses: {
      201: { description: 'Broadcast queued', content: { 'application/json': { schema: envelopeOf(BroadcastOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const created = await broadcastService.createBroadcast({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    // Send the first batch inline so small blasts complete immediately; the
    // cron worker drains anything larger.
    const result = await broadcastService.processBatch(created.id)
    return c.json(ok(c, 'Broadcast queued successfully', result.broadcast), 201)
  },
)

// GET /notifications/broadcasts
adminBroadcasts.openapi(
  createRoute({
    method: 'get',
    path: '/notifications/broadcasts',
    tags: ['Admin Broadcasts'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        cursor: z.string().optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: { description: 'Broadcasts', content: { 'application/json': { schema: envelopeOf(BroadcastListOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { cursor, pageSize } = c.req.valid('query')
    const result = await broadcastService.listBroadcasts({ cursor, pageSize })
    return c.json(ok(c, 'Broadcasts fetched successfully', result), 200)
  },
)

// GET /notifications/broadcasts/{id} — progress of an in-flight blast
adminBroadcasts.openapi(
  createRoute({
    method: 'get',
    path: '/notifications/broadcasts/{id}',
    tags: ['Admin Broadcasts'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Broadcast', content: { 'application/json': { schema: envelopeOf(BroadcastOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    return c.json(ok(c, 'Broadcast fetched successfully', await broadcastService.getBroadcast(id)), 200)
  },
)

// POST /notifications/broadcasts/{id}/resume — push another batch by hand
adminBroadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/broadcasts/{id}/resume',
    tags: ['Admin Broadcasts'],
    summary: 'Process the next batch without waiting for cron',
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Batch processed', content: { 'application/json': { schema: envelopeOf(BroadcastOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await broadcastService.processBatch(id)
    return c.json(ok(c, 'Broadcast batch processed successfully', result.broadcast), 200)
  },
)

// POST /notifications/broadcasts/{id}/cancel
adminBroadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/broadcasts/{id}/cancel',
    tags: ['Admin Broadcasts'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Broadcast cancelled', content: { 'application/json': { schema: envelopeOf(BroadcastOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    return c.json(ok(c, 'Broadcast cancelled successfully', await broadcastService.cancelBroadcast(id)), 200)
  },
)

// --- payout settlement -------------------------------------------------------

const SettleRequest = z
  .object({
    status: z.enum(['PROCESSING', 'PAID', 'FAILED', 'CANCELLED']),
    reference: z.string().nullable().optional(),
    failureReason: z.string().max(500).nullable().optional(),
  })
  .openapi('PayoutSettleRequest')

// POST /payouts/{id}/settle — moves a cash-out to its final state and notifies
adminBroadcasts.openapi(
  createRoute({
    method: 'post',
    path: '/payouts/{id}/settle',
    tags: ['Admin Payouts'],
    summary: 'Mark a cash-out paid, failed or cancelled (notifies the cleaner)',
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: SettleRequest } } } },
    responses: {
      200: { description: 'Payout settled', content: { 'application/json': { schema: envelopeOf(PayoutOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { status, reference, failureReason } = c.req.valid('json')
    const payout = await earningsService.settlePayout({ payoutId: id, status, reference, failureReason })
    return c.json(ok(c, 'Payout settled successfully', payout), 200)
  },
)

// GET /payouts/unsettled — the settlement work queue
adminBroadcasts.openapi(
  createRoute({
    method: 'get',
    path: '/payouts/unsettled',
    tags: ['Admin Payouts'],
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }) },
    responses: {
      200: { description: 'Unsettled payouts', content: { 'application/json': { schema: envelopeOf(z.array(PayoutOut)) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { limit } = c.req.valid('query')
    const items = await earningsService.listUnsettledPayouts(limit)
    return c.json(ok(c, 'Unsettled payouts fetched successfully', items), 200)
  },
)
