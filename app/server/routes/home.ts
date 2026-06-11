import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import { HomePageModel } from '@/server/schemas/home'
import * as homeService from '@/server/services/home-service'

/** /v1/home — bespoke customer home aggregation. */
export const home = createRouter()

home.use('/', requireCustomer())

home.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Home'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Home', content: { 'application/json': { schema: envelopeOf(HomePageModel) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const data = await homeService.getHome(principalOf(c))
    return c.json(ok(c, 'Home fetched successfully', data), 200)
  },
)
