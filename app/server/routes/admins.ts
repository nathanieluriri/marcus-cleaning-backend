import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { AdminLogin, AdminOut } from '@/server/schemas/admin'
import { RefreshRequest, TokenResponse, readRefreshToken } from '@/server/schemas/auth'
import * as adminService from '@/server/services/admin-service'
import { registerSessionRoutes } from './_session-routes'

/**
 * /v1/admins — admin auth + profile + sessions.
 * Admin-feature CRUD sub-routers mount here too (see admin-features/* and app.ts).
 * See: docs/migration/07-domain-endpoints.md
 */

export const admins = createRouter()

function deviceFrom(c: AppContext) {
  return {
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
  }
}

function tokens(r: { accessToken: string; refreshToken: string; expiresIn: number; language: 'en' | 'fr' }) {
  return { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language }
}

const AuthResultData = z.object({ admin: AdminOut, tokens: TokenResponse }).openapi('AdminAuthResult')
const errs = {
  401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

admins.openapi(
  createRoute({
    method: 'post',
    path: '/login',
    tags: ['Admins'],
    request: { body: { content: { 'application/json': { schema: AdminLogin } } } },
    responses: {
      200: { description: 'Login successful', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
      ...errs,
    },
  }),
  async (c) => {
    const r = await adminService.login(c.req.valid('json'), deviceFrom(c))
    return c.json(ok(c, 'Login successful', { admin: r.admin, tokens: tokens(r) }), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Admins'],
    request: { body: { content: { 'application/json': { schema: RefreshRequest } } } },
    responses: {
      200: { description: 'Tokens refreshed', content: { 'application/json': { schema: envelopeOf(TokenResponse) } } },
      ...errs,
    },
  }),
  async (c) => {
    const r = await adminService.refresh(readRefreshToken(c.req.valid('json')), deviceFrom(c))
    return c.json(ok(c, 'Tokens refreshed successfully', tokens(r)), 200)
  },
)

admins.use('/profile', requireAdmin())
admins.openapi(
  createRoute({
    method: 'get',
    path: '/profile',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Admin profile', content: { 'application/json': { schema: envelopeOf(AdminOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const admin = await adminService.getProfile(p.userId)
    return c.json(ok(c, 'Profile fetched successfully', admin), 200)
  },
)

registerSessionRoutes(admins, requireAdmin(), 'Admins')
