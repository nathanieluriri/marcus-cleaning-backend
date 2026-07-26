import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { withIdempotency } from '@/server/core/idempotency'
import {
  BalanceOut,
  CashOutRequest,
  EarningsOut,
  EarningsPeriod,
  PayoutListOut,
  PayoutOut,
} from '@/server/schemas/earnings'
import {
  AvailabilityOut,
  AvailabilityUpdateRequest,
  ScheduleOut,
  ScheduleQuery,
  TodayOut,
} from '@/server/schemas/availability'
import * as earningsService from '@/server/services/earnings-service'
import * as availabilityService from '@/server/services/availability-service'

/**
 * /v1/cleaner — earnings, payouts, balance, schedule, availability, and the
 * jobs-dashboard "today" aggregate. Mounted under /api/v1/cleaner (see app.ts),
 * alongside the jobs and profile routers.
 */

export const cleanerWorkspace = createRouter()

const errs = {
  400: { description: 'Bad request', content: { 'application/json': { schema: ErrorEnvelope } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdempotencyHeader = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(200)
    .optional()
    .openapi({
      // Key and param name must match (Hono lowercases incoming header names);
      // clients may still send the conventional `Idempotency-Key` casing.
      param: { name: 'idempotency-key', in: 'header', required: false },
      description: 'Retry-safe key. A repeat with the same key and body replays the original response.',
    }),
})

for (const path of [
  '/earnings',
  '/payouts',
  '/payouts/*',
  '/balance',
  '/schedule',
  '/availability',
  '/today',
]) {
  cleanerWorkspace.use(path, requireCleaner())
}

// GET /earnings?period=week|month|year
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/earnings',
    tags: ['Cleaner Earnings'],
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ period: EarningsPeriod.default('week') }) },
    responses: {
      200: { description: 'Earnings', content: { 'application/json': { schema: envelopeOf(EarningsOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { period } = c.req.valid('query')
    const earnings = await earningsService.getEarnings({ principal: principalOf(c), period })
    return c.json(ok(c, 'Earnings fetched successfully', earnings), 200)
  },
)

// GET /balance
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/balance',
    tags: ['Cleaner Earnings'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Balance', content: { 'application/json': { schema: envelopeOf(BalanceOut) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const balance = await earningsService.getBalance(principalOf(c))
    return c.json(ok(c, 'Balance fetched successfully', balance), 200)
  },
)

// GET /payouts
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/payouts',
    tags: ['Cleaner Earnings'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        cursor: z.string().optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: { description: 'Payouts', content: { 'application/json': { schema: envelopeOf(PayoutListOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { cursor, pageSize } = c.req.valid('query')
    const result = await earningsService.listPayouts({ principal: principalOf(c), cursor, pageSize })
    return c.json(ok(c, 'Payouts fetched successfully', result), 200)
  },
)

// POST /payouts/cash-out — idempotent so a double tap cannot double-withdraw
cleanerWorkspace.openapi(
  createRoute({
    method: 'post',
    path: '/payouts/cash-out',
    tags: ['Cleaner Earnings'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: IdempotencyHeader,
      body: { content: { 'application/json': { schema: CashOutRequest } } },
    },
    responses: {
      201: { description: 'Cash-out requested', content: { 'application/json': { schema: envelopeOf(PayoutOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const principal = principalOf(c)
    const payload = c.req.valid('json')
    const result = await withIdempotency({
      scope: 'payout.cashout',
      key: c.req.header('Idempotency-Key'),
      actorId: principal.userId,
      body: payload,
      httpStatus: 201,
      operation: () => earningsService.requestCashOut({ principal, payload }),
    })
    return c.json(ok(c, 'Cash-out requested successfully', result.data), 201)
  },
)

// GET /schedule?from=&to=
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/schedule',
    tags: ['Cleaner Schedule'],
    security: [{ bearerAuth: [] }],
    request: { query: ScheduleQuery },
    responses: {
      200: { description: 'Schedule', content: { 'application/json': { schema: envelopeOf(ScheduleOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { from, to } = c.req.valid('query')
    const schedule = await availabilityService.getSchedule({ principal: principalOf(c), from, to })
    return c.json(ok(c, 'Schedule fetched successfully', schedule), 200)
  },
)

// GET /availability
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/availability',
    tags: ['Cleaner Schedule'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Availability', content: { 'application/json': { schema: envelopeOf(AvailabilityOut) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const availability = await availabilityService.getAvailability(principalOf(c))
    return c.json(ok(c, 'Availability fetched successfully', availability), 200)
  },
)

// PUT /availability
cleanerWorkspace.openapi(
  createRoute({
    method: 'put',
    path: '/availability',
    tags: ['Cleaner Schedule'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: AvailabilityUpdateRequest } } } },
    responses: {
      200: { description: 'Availability updated', content: { 'application/json': { schema: envelopeOf(AvailabilityOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const availability = await availabilityService.updateAvailability({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Availability updated successfully', availability), 200)
  },
)

// GET /today — jobs dashboard header
cleanerWorkspace.openapi(
  createRoute({
    method: 'get',
    path: '/today',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Today', content: { 'application/json': { schema: envelopeOf(TodayOut) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const today = await availabilityService.getToday(principalOf(c))
    return c.json(ok(c, 'Today fetched successfully', today), 200)
  },
)
