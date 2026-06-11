import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer } from '@/server/security/guards'
import { CatalogServiceOut } from '@/server/schemas/catalog'
import * as catalogService from '@/server/services/catalog-service'

/** /v1/services — public, read-only service catalog (customer-guarded). */
export const catalog = createRouter()

catalog.use('/', requireCustomer())

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
