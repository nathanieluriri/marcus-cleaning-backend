import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import {
  PromotionOut,
  PromotionValidateOut,
  PromotionValidateRequest,
} from '@/server/schemas/promotion'
import * as promotionService from '@/server/services/promotion-service'

/**
 * /v1/promotions — customer-facing promo cards and code validation.
 * Mounted under /api/v1/promotions (see server/app.ts).
 *
 * Discounts are computed here, never in the client.
 */

export const promotions = createRouter()

const errs = {
  400: {
    description: 'Promo code rejected (details.reason carries the typed cause)',
    content: { 'application/json': { schema: ErrorEnvelope } },
  },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

promotions.use('*', requireCustomer())

// GET / — active promotions for the home screen
promotions.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Promotions'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Promotions', content: { 'application/json': { schema: envelopeOf(z.array(PromotionOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await promotionService.listPromotions()
    return c.json(ok(c, 'Promotions fetched successfully', items), 200)
  },
)

// POST /validate — authoritative discount for a code + cart
promotions.openapi(
  createRoute({
    method: 'post',
    path: '/validate',
    tags: ['Promotions'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: PromotionValidateRequest } } } },
    responses: {
      200: { description: 'Code valid', content: { 'application/json': { schema: envelopeOf(PromotionValidateOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const result = await promotionService.validatePromotion({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Promo code applied successfully', result), 200)
  },
)
