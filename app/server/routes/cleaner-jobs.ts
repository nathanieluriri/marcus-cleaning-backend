import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerJobOut, CleanerJobDeclineRequest } from '@/server/schemas/cleaner-job'
import * as jobsService from '@/server/services/cleaner-jobs-service'

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

cleanerJobs.use('/jobs', requireCleaner())
cleanerJobs.use('/jobs/*', requireCleaner())

// GET /jobs
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Jobs', content: { 'application/json': { schema: envelopeOf(z.array(CleanerJobOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await jobsService.listJobs(principalOf(c))
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
