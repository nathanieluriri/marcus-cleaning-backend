import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer } from '@/server/security/guards'
import { CatalogServiceOut, ServicePricingOut } from '@/server/schemas/catalog'
import * as catalogService from '@/server/services/catalog-service'

/** /v1/services — public, read-only service catalog (customer-guarded). */
export const catalog = createRouter()

catalog.use('/', requireCustomer())
catalog.use('/:serviceId/pricing', requireCustomer())

catalog.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Catalog'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Services', content: { 'application/json': { schema: envelopeOf(z.array(CatalogServiceOut)) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const items = await catalogService.listServices()
    return c.json(ok(c, 'Services fetched successfully', items), 200)
  },
)

// GET /{serviceId}/pricing — rate, minimum hours and extras for the picker.
// Totals still come from POST /v1/bookings/quote; this supplies its inputs.
catalog.openapi(
  createRoute({
    method: 'get',
    path: '/{serviceId}/pricing',
    tags: ['Catalog'],
    summary: 'Base rate, minimum hours and available extras for a service',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        serviceId: z
          .string()
          .openapi({ param: { name: 'serviceId', in: 'path' }, example: '665f1b2c9a1e4b0012service' }),
      }),
    },
    responses: {
      200: { description: 'Pricing', content: { 'application/json': { schema: envelopeOf(ServicePricingOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const { serviceId } = c.req.valid('param')
    const pricing = await catalogService.getServicePricing(serviceId)
    return c.json(ok(c, 'Service pricing fetched successfully', pricing), 200)
  },
)
