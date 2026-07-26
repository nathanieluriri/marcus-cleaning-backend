import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { notFound } from '@/server/core/errors'
import {
  ApplicationDecisionRequest,
  ApplicationOut,
  ApplicationStatus,
} from '@/server/schemas/cleaner-application'
import { SosAlertOut } from '@/server/schemas/job-session'
import * as applicationService from '@/server/services/cleaner-application-service'
import * as sessionRepo from '@/server/repositories/job-session-repo'

/**
 * /v1/admins — cleaner-application review and the SOS alert queue.
 *
 * Mounted under /api/v1/admins alongside the other admin routers. These are the
 * operator side of two cleaner-facing features: without them, submitted
 * applications and raised SOS alerts would have nowhere to land.
 */

export const adminSafety = createRouter()

const errs = {
  400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

adminSafety.use('/applications', requireAdmin())
adminSafety.use('/applications/*', requireAdmin())
adminSafety.use('/sos-alerts', requireAdmin())
adminSafety.use('/sos-alerts/*', requireAdmin())

// GET /applications — review queue
adminSafety.openapi(
  createRoute({
    method: 'get',
    path: '/applications',
    tags: ['Admin Applications'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        status: ApplicationStatus.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        skip: z.coerce.number().int().min(0).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Applications',
        content: {
          'application/json': {
            schema: envelopeOf(z.object({ items: z.array(ApplicationOut), total: z.number().int() })),
          },
        },
      },
      ...errs,
    },
  }),
  async (c) => {
    const { status, limit, skip } = c.req.valid('query')
    const result = await applicationService.listQueue({
      statuses: status ? [status] : undefined,
      limit,
      skip,
    })
    return c.json(ok(c, 'Applications fetched successfully', result), 200)
  },
)

// PATCH /applications/{id}/decision — approve / reject / request more info
adminSafety.openapi(
  createRoute({
    method: 'patch',
    path: '/applications/{id}/decision',
    tags: ['Admin Applications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ApplicationDecisionRequest } } } },
    responses: {
      200: { description: 'Decision applied', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const app = await applicationService.decideApplication({
      principal: principalOf(c),
      id,
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Application decision applied successfully', app), 200)
  },
)

// GET /sos-alerts — open safety alerts, newest first
adminSafety.openapi(
  createRoute({
    method: 'get',
    path: '/sos-alerts',
    tags: ['Admin Safety'],
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }) },
    responses: {
      200: { description: 'SOS alerts', content: { 'application/json': { schema: envelopeOf(z.array(SosAlertOut)) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { limit } = c.req.valid('query')
    const items = await sessionRepo.listOpenAlerts(limit)
    return c.json(ok(c, 'SOS alerts fetched successfully', items), 200)
  },
)

// PATCH /sos-alerts/{id} — acknowledge or resolve
adminSafety.openapi(
  createRoute({
    method: 'patch',
    path: '/sos-alerts/{id}',
    tags: ['Admin Safety'],
    security: [{ bearerAuth: [] }],
    request: {
      params: IdParam,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) })
              .openapi('SosAlertUpdateRequest'),
          },
        },
      },
    },
    responses: {
      200: { description: 'Alert updated', content: { 'application/json': { schema: envelopeOf(SosAlertOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { status } = c.req.valid('json')
    const now = Math.floor(Date.now() / 1000)
    const updated = await sessionRepo.updateAlert(id, {
      status,
      acknowledgedAt: now,
      acknowledgedBy: principalOf(c).userId,
      ...(status === 'RESOLVED' ? { resolvedAt: now } : {}),
    })
    if (!updated) throw notFound('SOS alert not found')
    return c.json(ok(c, 'SOS alert updated successfully', updated), 200)
  },
)
