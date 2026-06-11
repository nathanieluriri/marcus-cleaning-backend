import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer } from '@/server/security/guards'
import {
  CleanerBrowseQuery,
  CleanerCardOut,
  CleanerPublicProfileOut,
  CleanerReviewListOut,
  CleanerReviewQuery,
} from '@/server/schemas/cleaner-directory'
import { ServiceExtraOut } from '@/server/schemas/catalog'
import * as directory from '@/server/services/cleaner-directory-service'
import * as catalogService from '@/server/services/catalog-service'

/**
 * /v1/bookings discovery sub-surface: customer-facing cleaner browse/profile/
 * reviews and per-service extras. Mounted at /api/v1/bookings BEFORE the main
 * bookings router so its static segments (`cleaners`, `services`) take priority
 * over the booking-id param routes. All customer-guarded.
 */
export const bookingDiscovery = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const cleanerIdParam = z.object({
  cleanerId: z.string().openapi({ param: { name: 'cleanerId', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})
const serviceIdParam = z.object({
  serviceId: z.string().openapi({ param: { name: 'serviceId', in: 'path' }, example: '665f1b2c9a1e4b0012service' }),
})

bookingDiscovery.use('/cleaners', requireCustomer())
bookingDiscovery.use('/cleaners/*', requireCustomer())
bookingDiscovery.use('/services/*', requireCustomer())

// GET /cleaners — browse
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { query: CleanerBrowseQuery },
    responses: {
      200: { description: 'Cleaners', content: { 'application/json': { schema: envelopeOf(z.array(CleanerCardOut)) } } },
      401: errs[401],
      422: errs[422],
    },
  }),
  async (c) => {
    const items = await directory.browse(c.req.valid('query'))
    return c.json(ok(c, 'Cleaners fetched successfully', items), 200)
  },
)

// GET /cleaners/{cleanerId} — public profile
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners/{cleanerId}',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: cleanerIdParam },
    responses: {
      200: { description: 'Cleaner profile', content: { 'application/json': { schema: envelopeOf(CleanerPublicProfileOut) } } },
      401: errs[401],
      404: errs[404],
    },
  }),
  async (c) => {
    const { cleanerId } = c.req.valid('param')
    const profile = await directory.getPublicProfile(cleanerId)
    return c.json(ok(c, 'Cleaner profile fetched successfully', profile), 200)
  },
)

// GET /cleaners/{cleanerId}/reviews — paginated
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners/{cleanerId}/reviews',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: cleanerIdParam, query: CleanerReviewQuery },
    responses: {
      200: { description: 'Cleaner reviews', content: { 'application/json': { schema: envelopeOf(CleanerReviewListOut) } } },
      401: errs[401],
      422: errs[422],
    },
  }),
  async (c) => {
    const { cleanerId } = c.req.valid('param')
    const result = await directory.listCleanerReviews(cleanerId, c.req.valid('query'))
    return c.json(ok(c, 'Cleaner reviews fetched successfully', result), 200)
  },
)

// GET /services/{serviceId}/extras
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/services/{serviceId}/extras',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: serviceIdParam },
    responses: {
      200: { description: 'Service extras', content: { 'application/json': { schema: envelopeOf(z.array(ServiceExtraOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const { serviceId } = c.req.valid('param')
    const items = await catalogService.listServiceExtras(serviceId)
    return c.json(ok(c, 'Service extras fetched successfully', items), 200)
  },
)
