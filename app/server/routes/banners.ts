import { createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import type { Env } from '@/server/core/http-env'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, requireAdmin } from '@/server/security/guards'
import { BannerCreateRequest, BannerUpdateRequest, BannerOut } from '@/server/schemas/banner'
import * as bannerService from '@/server/services/banner-service'

/**
 * /v1/banners — banner CRUD (collection `banner`).
 * List/get are open to authenticated users (any role); create/update/delete require admin.
 * Mounted under /api/v1/banners (see server/app.ts).
 * See: docs/migration/07-domain-endpoints.md
 */

export const banners = createRouter()

const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }) })

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// Reads require an authenticated customer; writes require an admin. The mount paths
// `/` and `/{id}` serve both, so dispatch the guard by HTTP method.
const customerGuard = requireCustomer()
const adminGuard = requireAdmin()
const guardByMethod = createMiddleware<Env>(async (c, next) => {
  if (c.req.method === 'GET') return customerGuard(c, next)
  return adminGuard(c, next)
})
// Wildcard so the guard fires on dynamic `:id` routes too. Hono treats `/{id}`
// as a literal segment (params use `:id`), so `.use('/{id}', …)` would never
// match — leaving mutations unguarded. `*` covers `/` and every sub-path; the
// by-method dispatch keeps GET on the customer guard and writes on admin.
banners.use('*', guardByMethod)

// GET / — list (authenticated)
banners.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Banners'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Banners', content: { 'application/json': { schema: envelopeOf(z.array(BannerOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await bannerService.listBanners()
    return c.json(ok(c, 'Banners fetched successfully', items), 200)
  },
)

// POST / — admin only
banners.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Banners'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: BannerCreateRequest } } } },
    responses: {
      201: { description: 'Banner created', content: { 'application/json': { schema: envelopeOf(BannerOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const payload = c.req.valid('json')
    const banner = await bannerService.createBanner(payload)
    return c.json(ok(c, 'Banner created successfully', banner), 201)
  },
)

// GET /{id} — authenticated
banners.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Banners'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Banner', content: { 'application/json': { schema: envelopeOf(BannerOut) } } },
      401: errs[401],
      404: errs[404],
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const banner = await bannerService.getBanner(id)
    return c.json(ok(c, 'Banner fetched successfully', banner), 200)
  },
)

// PATCH /{id} — admin only
banners.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Banners'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: BannerUpdateRequest } } } },
    responses: {
      200: { description: 'Banner updated', content: { 'application/json': { schema: envelopeOf(BannerOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const payload = c.req.valid('json')
    const banner = await bannerService.updateBanner(id, payload)
    return c.json(ok(c, 'Banner updated successfully', banner), 200)
  },
)

// DELETE /{id} — admin only
banners.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Banners'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Banner deleted', content: { 'application/json': { schema: envelopeOf(z.object({ id: z.string() })) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await bannerService.deleteBanner(id)
    return c.json(ok(c, 'Banner deleted successfully', { id }), 200)
  },
)
