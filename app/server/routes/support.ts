import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomerOrCleaner, principalOf } from '@/server/security/guards'
import {
  FaqAudience,
  FaqListOut,
  SupportTicketCreateRequest,
  SupportTicketListOut,
  SupportTicketOut,
} from '@/server/schemas/support'
import * as supportService from '@/server/services/support-service'

/**
 * /v1/support — FAQ content and support tickets, shared by both apps.
 * Mounted under /api/v1/support (see server/app.ts). The FAQ is also exposed
 * at /api/v1/faq for the path the apps assume.
 */

export const support = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

support.use('/tickets', requireCustomerOrCleaner())
support.use('/tickets/*', requireCustomerOrCleaner())

// POST /tickets
support.openapi(
  createRoute({
    method: 'post',
    path: '/tickets',
    tags: ['Support'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: SupportTicketCreateRequest } } } },
    responses: {
      201: { description: 'Ticket created', content: { 'application/json': { schema: envelopeOf(SupportTicketOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const ticket = await supportService.createTicket({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Support ticket created successfully', ticket), 201)
  },
)

// GET /tickets
support.openapi(
  createRoute({
    method: 'get',
    path: '/tickets',
    tags: ['Support'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        cursor: z.string().optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: { description: 'Tickets', content: { 'application/json': { schema: envelopeOf(SupportTicketListOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { cursor, pageSize } = c.req.valid('query')
    const result = await supportService.listTickets({ principal: principalOf(c), cursor, pageSize })
    return c.json(ok(c, 'Support tickets fetched successfully', result), 200)
  },
)

// GET /tickets/{id}
support.openapi(
  createRoute({
    method: 'get',
    path: '/tickets/{id}',
    tags: ['Support'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Ticket', content: { 'application/json': { schema: envelopeOf(SupportTicketOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const ticket = await supportService.getTicket({ principal: principalOf(c), id })
    return c.json(ok(c, 'Support ticket fetched successfully', ticket), 200)
  },
)

/**
 * /v1/faq — public FAQ content. Deliberately unauthenticated: the help screen
 * is reachable before sign-in, and none of this is user data.
 */
export const faq = createRouter()

faq.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Support'],
    request: { query: z.object({ audience: FaqAudience.default('all') }) },
    responses: {
      200: { description: 'FAQ', content: { 'application/json': { schema: envelopeOf(FaqListOut) } } },
      422: errs[422],
    },
  }),
  async (c) => {
    const { audience } = c.req.valid('query')
    const result = await supportService.listFaq(audience)
    return c.json(ok(c, 'FAQ fetched successfully', result), 200)
  },
)
