import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { requireCustomer, principalOf } from '@/server/security/guards'
import { getProviderByName } from '@/server/core/payments/manager'
import * as paymentService from '@/server/services/payment-service'
import {
  PaymentMethodCreate,
  PaymentMethodList,
  PaymentMethodOut,
  PaymentMethodUpdate,
  PaymentOut,
  ReconcileResult,
  RefundRequest,
} from '@/server/schemas/payment'

/**
 * /v1/payments — webhooks (public, signature-verified), payment methods CRUD,
 * payment reads, refund, and manual reconcile (all customer-guarded except the
 * webhook). Mounted under /api/v1/payments (see server/app.ts).
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/09-payments.md
 */

export const payments = createRouter()

const authErr = { 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } } }
const notFoundErr = { 404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } } }

function headerMap(c: AppContext): Record<string, string> {
  const out: Record<string, string> = {}
  c.req.raw.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

// --- POST /webhooks/{provider} — PUBLIC, signature-verified, raw body ---
// Plain Hono handler (not .openapi): must read the raw body before any JSON
// parsing and must NOT be behind the auth guard. Verification failure throws an
// AppError(400), surfaced by the app's onError. Returns 200 text quickly.
payments.post('/webhooks/:provider', async (c) => {
  const provider = getProviderByName(c.req.param('provider'))
  const body = new Uint8Array(await c.req.arrayBuffer())
  const event = await provider.verifyWebhook({ body, headers: headerMap(c) })
  await paymentService.applyWebhookEvent(event)
  return c.text('OK', 200)
})

// --- payment methods (customer-guarded) ---

payments.use('/methods', requireCustomer())
payments.use('/methods/*', requireCustomer())

payments.openapi(
  createRoute({
    method: 'get',
    path: '/methods',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Payment methods', content: { 'application/json': { schema: envelopeOf(PaymentMethodList) } } },
      ...authErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const items = await paymentService.listMethods(p.userId)
    return c.json(ok(c, 'Payment methods fetched successfully', { items }), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'post',
    path: '/methods',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: PaymentMethodCreate } } } },
    responses: {
      201: { description: 'Payment method created', content: { 'application/json': { schema: envelopeOf(PaymentMethodOut) } } },
      ...authErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const created = await paymentService.createMethod(p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Payment method created successfully', created), 201)
  },
)

payments.openapi(
  createRoute({
    method: 'patch',
    path: '/methods/{method_id}',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ method_id: z.string() }),
      body: { content: { 'application/json': { schema: PaymentMethodUpdate } } },
    },
    responses: {
      200: { description: 'Payment method updated', content: { 'application/json': { schema: envelopeOf(PaymentMethodOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { method_id } = c.req.valid('param')
    const updated = await paymentService.updateMethod(method_id, p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Payment method updated successfully', updated), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'delete',
    path: '/methods/{method_id}',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ method_id: z.string() }) },
    responses: {
      200: { description: 'Payment method deleted', content: { 'application/json': { schema: envelopeOf(z.object({ ok: z.boolean() })) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { method_id } = c.req.valid('param')
    await paymentService.deleteMethod(method_id, p.userId)
    return c.json(ok(c, 'Payment method deleted successfully', { ok: true }), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'post',
    path: '/methods/{method_id}/set-default',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ method_id: z.string() }) },
    responses: {
      200: { description: 'Default payment method set', content: { 'application/json': { schema: envelopeOf(PaymentMethodOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { method_id } = c.req.valid('param')
    const updated = await paymentService.setDefaultMethod(method_id, p.userId)
    return c.json(ok(c, 'Default payment method set successfully', updated), 200)
  },
)

// --- payment reads + actions (customer-guarded) ---

payments.use('/reference/*', requireCustomer())
payments.use('/:payment_id', requireCustomer())
payments.use('/:payment_id/*', requireCustomer())

payments.openapi(
  createRoute({
    method: 'get',
    path: '/reference/{reference}',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ reference: z.string() }) },
    responses: {
      200: { description: 'Payment', content: { 'application/json': { schema: envelopeOf(PaymentOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { reference } = c.req.valid('param')
    const payment = await paymentService.getByReferenceForCustomer(reference, p.userId)
    return c.json(ok(c, 'Payment fetched successfully', payment), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'get',
    path: '/{payment_id}',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ payment_id: z.string() }) },
    responses: {
      200: { description: 'Payment', content: { 'application/json': { schema: envelopeOf(PaymentOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { payment_id } = c.req.valid('param')
    const payment = await paymentService.getByIdForCustomer(payment_id, p.userId)
    return c.json(ok(c, 'Payment fetched successfully', payment), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'post',
    path: '/{payment_id}/refund',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ payment_id: z.string() }),
      body: { content: { 'application/json': { schema: RefundRequest } } },
    },
    responses: {
      200: { description: 'Payment refunded', content: { 'application/json': { schema: envelopeOf(PaymentOut) } } },
      409: { description: 'Not refundable', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { payment_id } = c.req.valid('param')
    const { amountMinor } = c.req.valid('json')
    const payment = await paymentService.refund(payment_id, p.userId, { amountMinor })
    return c.json(ok(c, 'Payment refunded successfully', payment), 200)
  },
)

payments.openapi(
  createRoute({
    method: 'post',
    path: '/{payment_id}/reconcile',
    tags: ['Payments'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ payment_id: z.string() }) },
    responses: {
      200: { description: 'Payment reconciled', content: { 'application/json': { schema: envelopeOf(PaymentOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { payment_id } = c.req.valid('param')
    const payment = await paymentService.reconcileOne(payment_id, p.userId)
    return c.json(ok(c, 'Payment reconciled successfully', payment), 200)
  },
)

// `ReconcileResult` is exported for the cron endpoint (doc 10) that calls
// paymentService.reconcilePendingPayments and returns this shape.
export { ReconcileResult }
