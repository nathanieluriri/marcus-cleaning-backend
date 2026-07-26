import { createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import type { Env } from '@/server/core/http-env'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import {
  ReviewCreateRequest,
  ReviewUpdateRequest,
  ReviewListQuery,
  ReviewOut,
} from '@/server/schemas/review'
import * as reviewService from '@/server/services/review-service'

/**
 * /v1/reviews — review CRUD (collection `reviews`).
 * List/get are open-ish; create/update/delete require the customer author.
 * Mounted under /api/v1/reviews (see server/app.ts).
 * See: docs/migration/07-domain-endpoints.md
 */

export const reviews = createRouter()

const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }) })

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// GET / — list (optionally by cleaner_id)
reviews.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Reviews'],
    request: { query: ReviewListQuery },
    responses: {
      200: { description: 'Reviews', content: { 'application/json': { schema: envelopeOf(z.array(ReviewOut)) } } },
      422: errs[422],
    },
  }),
  async (c) => {
    const { cleaner_id, stars, timePeriod, pageSize } = c.req.valid('query')
    const items = await reviewService.listReviews({ cleaner_id, stars, timePeriod, pageSize })
    return c.json(ok(c, 'Reviews fetched successfully', items), 200)
  },
)

// GET /{id}
reviews.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Reviews'],
    request: { params: IdParam },
    responses: {
      200: { description: 'Review', content: { 'application/json': { schema: envelopeOf(ReviewOut) } } },
      404: errs[404],
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const review = await reviewService.getReview(id)
    return c.json(ok(c, 'Review fetched successfully', review), 200)
  },
)

// --- author-guarded mutations ---
// GET / and GET /{id} stay open-ish; only mutating methods require the customer.
const customerGuard = requireCustomer()
const guardMutations = createMiddleware<Env>(async (c, next) => {
  if (c.req.method === 'GET') return next()
  return customerGuard(c, next)
})
// Wildcard so the guard fires on the dynamic `:id` route too (`/{id}` is a
// literal to Hono and would never match). guardMutations lets GET through.
reviews.use('*', guardMutations)

// POST /
reviews.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Reviews'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: ReviewCreateRequest } } } },
    responses: {
      201: { description: 'Review created', content: { 'application/json': { schema: envelopeOf(ReviewOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const payload = c.req.valid('json')
    const review = await reviewService.createReview({ principal: principalOf(c), payload })
    return c.json(ok(c, 'Review created successfully', review), 201)
  },
)

// PATCH /{id}
reviews.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Reviews'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ReviewUpdateRequest } } } },
    responses: {
      200: { description: 'Review updated', content: { 'application/json': { schema: envelopeOf(ReviewOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const payload = c.req.valid('json')
    const review = await reviewService.updateReview({ principal: principalOf(c), id, payload })
    return c.json(ok(c, 'Review updated successfully', review), 200)
  },
)

// DELETE /{id}
reviews.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Reviews'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Review deleted', content: { 'application/json': { schema: envelopeOf(z.object({ id: z.string() })) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await reviewService.deleteReview({ principal: principalOf(c), id })
    return c.json(ok(c, 'Review deleted successfully', { id }), 200)
  },
)
