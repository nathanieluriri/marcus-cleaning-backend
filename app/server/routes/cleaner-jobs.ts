import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import {
  CleanerJobOut,
  CleanerJobDeclineRequest,
  CleanerJobListQuery,
} from '@/server/schemas/cleaner-job'
import {
  ChecklistTask,
  ChecklistToggleRequest,
  EnRouteRequest,
  JobCompletionOut,
  JobSessionOut,
  SosAlertOut,
  SosRequest,
} from '@/server/schemas/job-session'
import { withIdempotency } from '@/server/core/idempotency'
import * as jobsService from '@/server/services/cleaner-jobs-service'
import * as jobSessionService from '@/server/services/job-session-service'

/**
 * /v1/cleaner/jobs — cleaner-scoped job feed (mapped from bookings).
 * Mounted at /api/v1/cleaner (distinct from the /cleaners auth router).
 */
export const cleanerJobs = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const jobIdParam = z.object({
  jobId: z.string().openapi({ param: { name: 'jobId', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

/** Optional `Idempotency-Key` header — honoured on job completion. */
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

cleanerJobs.use('/jobs', requireCleaner())
cleanerJobs.use('/jobs/*', requireCleaner())

// GET /jobs
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs',
    tags: ['Cleaner Jobs'],
    summary: 'Job feed — filter by scope (available/assigned), radius and schedule',
    security: [{ bearerAuth: [] }],
    request: { query: CleanerJobListQuery },
    responses: {
      200: { description: 'Jobs', content: { 'application/json': { schema: envelopeOf(z.array(CleanerJobOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await jobsService.listJobs(principalOf(c), c.req.valid('query'))
    return c.json(ok(c, 'Jobs fetched successfully', items), 200)
  },
)

// GET /jobs/{jobId}
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs/{jobId}',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const job = await jobsService.getJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job fetched successfully', job), 200)
  },
)

// POST /jobs/{jobId}/accept
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/accept',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job accepted', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const job = await jobsService.acceptJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job accepted successfully', job), 200)
  },
)

// POST /jobs/{jobId}/decline
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/decline',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam, body: { content: { 'application/json': { schema: CleanerJobDeclineRequest } } } },
    responses: {
      200: { description: 'Job declined', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      400: { description: 'Cannot decline', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    void c.req.valid('json') // reason is accepted (and currently advisory)
    const job = await jobsService.declineJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job declined successfully', job), 200)
  },
)

// --- in-progress job lifecycle ---------------------------------------------
// The timer, checklist and completion are server-owned; see job-session-service.

const taskParam = z.object({
  jobId: z.string().openapi({ param: { name: 'jobId', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
  taskId: z.string().openapi({ param: { name: 'taskId', in: 'path' }, example: 'kitchen-surfaces' }),
})

// POST /jobs/{jobId}/en-route — lights up the customer's "on the way" bar
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/en-route',
    tags: ['Cleaner Jobs'],
    summary: 'Declare you are on the way, optionally with an ETA',
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam, body: { content: { 'application/json': { schema: EnRouteRequest } } } },
    responses: {
      200: { description: 'Marked en route', content: { 'application/json': { schema: envelopeOf(JobSessionOut) } } },
      400: { description: 'Job not in an acceptable state', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const { etaAt, etaMinutes } = c.req.valid('json')
    const session = await jobSessionService.markEnRoute({
      principal: principalOf(c),
      bookingId: jobId,
      etaAt,
      etaMinutes,
    })
    return c.json(ok(c, 'Marked as on the way', session), 200)
  },
)

// POST /jobs/{jobId}/start — authoritative start time
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/start',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job started', content: { 'application/json': { schema: envelopeOf(JobSessionOut) } } },
      400: { description: 'Job not startable', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const session = await jobSessionService.startJob({ principal: principalOf(c), bookingId: jobId })
    return c.json(ok(c, 'Job started successfully', session), 200)
  },
)

// GET /jobs/{jobId}/session — resume the timer after a crash or backgrounding
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs/{jobId}/session',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job session', content: { 'application/json': { schema: envelopeOf(JobSessionOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const session = await jobSessionService.getSession({ principal: principalOf(c), bookingId: jobId })
    return c.json(ok(c, 'Job session fetched successfully', session), 200)
  },
)

// GET /jobs/{jobId}/checklist — tasks derived from the booking's service + extras
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs/{jobId}/checklist',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Checklist', content: { 'application/json': { schema: envelopeOf(z.array(ChecklistTask)) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const tasks = await jobSessionService.getChecklist({ principal: principalOf(c), bookingId: jobId })
    return c.json(ok(c, 'Checklist fetched successfully', tasks), 200)
  },
)

// POST /jobs/{jobId}/checklist/{taskId} — tick / untick
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/checklist/{taskId}',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: taskParam, body: { content: { 'application/json': { schema: ChecklistToggleRequest } } } },
    responses: {
      200: { description: 'Task updated', content: { 'application/json': { schema: envelopeOf(JobSessionOut) } } },
      400: { description: 'Job not in progress', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId, taskId } = c.req.valid('param')
    const { done } = c.req.valid('json')
    const session = await jobSessionService.toggleTask({
      principal: principalOf(c),
      bookingId: jobId,
      taskId,
      done,
    })
    return c.json(ok(c, 'Checklist task updated successfully', session), 200)
  },
)

// POST /jobs/{jobId}/complete — idempotent; returns duration + payout
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/complete',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam, headers: IdempotencyHeader },
    responses: {
      200: { description: 'Job completed', content: { 'application/json': { schema: envelopeOf(JobCompletionOut) } } },
      400: { description: 'Job not completable', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Idempotency conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const principal = principalOf(c)
    const result = await withIdempotency({
      scope: 'job.complete',
      key: c.req.header('Idempotency-Key'),
      actorId: principal.userId,
      body: { jobId },
      operation: () => jobSessionService.completeJob({ principal, bookingId: jobId }),
    })
    return c.json(ok(c, 'Job completed successfully', result.data), 200)
  },
)

// POST /jobs/{jobId}/sos — safety-critical alert
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/sos',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam, body: { content: { 'application/json': { schema: SosRequest } } } },
    responses: {
      201: { description: 'SOS raised', content: { 'application/json': { schema: envelopeOf(SosAlertOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const alert = await jobSessionService.raiseSos({
      principal: principalOf(c),
      bookingId: jobId,
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'SOS alert raised successfully', alert), 201)
  },
)
