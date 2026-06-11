import { createRoute } from '@hono/zod-openapi'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import {
  ServiceCreditGrant,
  ServiceCreditBalanceOut,
  FeatureOut,
  CustomerIdParam,
} from '@/server/schemas/admin-features'
import { crudRouter } from './_crud'
import * as repo from '@/server/repositories/admin-features/_generic-repo'

/**
 * /service-credits — CRUD over `service_credit_ledger` plus:
 *   POST `/grant`             — grant credit to a customer (ledger entry)
 *   GET  `/balance/{customer_id}` — current credit balance for a customer
 * See: docs/migration/07-domain-endpoints.md
 */

const COLL = 'service_credit_ledger'
const TAG = 'ServiceCredits'

export const serviceCredits = crudRouter({ collection: COLL, tag: TAG, noun: 'service credit' })

serviceCredits.use('/grant', requireAdmin())
serviceCredits.openapi(
  createRoute({
    method: 'post',
    path: '/grant',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: ServiceCreditGrant } } } },
    responses: {
      201: { description: 'Credit granted', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const body = c.req.valid('json')
    const ts = Math.floor(Date.now() / 1000)
    const entry = await repo.insertRaw(COLL, {
      ...body,
      entryType: 'GRANT',
      grantedBy: p.userId,
      dateCreated: ts,
      lastUpdated: ts,
    })
    return c.json(ok(c, 'Service credit granted', FeatureOut.parse(entry)), 201)
  },
)

serviceCredits.use('/balance/:customer_id', requireAdmin())
serviceCredits.openapi(
  createRoute({
    method: 'get',
    path: '/balance/{customer_id}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: CustomerIdParam },
    responses: {
      200: { description: 'Credit balance', content: { 'application/json': { schema: envelopeOf(ServiceCreditBalanceOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    principalOf(c)
    const { customer_id } = c.req.valid('param')
    const balance = await repo.sumField(COLL, 'amount', { customer_id })
    return c.json(ok(c, 'Service credit balance', { customer_id, balance }), 200)
  },
)
