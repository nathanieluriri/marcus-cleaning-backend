import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '@/server/core/http-env'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { principalOf } from '@/server/security/guards'
import * as sessions from '@/server/services/auth-session-service'

/**
 * Registers the shared session-control endpoints on a role router:
 *   POST /sessions/revoke-others, /sessions/revoke-all, /sessions/logout
 * Ported from the session controls in the customer/cleaner/admin routes.
 * See: docs/migration/03-auth.md
 */
export function registerSessionRoutes(router: OpenAPIHono<Env>, guard: MiddlewareHandler, tag: string): void {
  const RevokedData = z.object({ revoked: z.number().int() }).openapi(`${tag}RevokedResult`)
  const auth = { 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } } }

  const revokeOthers = createRoute({
    method: 'post',
    path: '/sessions/revoke-others',
    tags: [tag],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Other sessions revoked', content: { 'application/json': { schema: envelopeOf(RevokedData) } } },
      ...auth,
    },
  })
  router.use('/sessions/revoke-others', guard)
  router.openapi(revokeOthers, async (c) => {
    const p = principalOf(c)
    const revoked = await sessions.revokeOtherSessions(p.userId, p.sessionId)
    return c.json(ok(c, 'Other sessions revoked', { revoked }), 200)
  })

  const revokeAll = createRoute({
    method: 'post',
    path: '/sessions/revoke-all',
    tags: [tag],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'All sessions revoked', content: { 'application/json': { schema: envelopeOf(RevokedData) } } },
      ...auth,
    },
  })
  router.use('/sessions/revoke-all', guard)
  router.openapi(revokeAll, async (c) => {
    const p = principalOf(c)
    const revoked = await sessions.revokeAllSessions(p.userId)
    return c.json(ok(c, 'All sessions revoked', { revoked }), 200)
  })

  const logout = createRoute({
    method: 'post',
    path: '/sessions/logout',
    tags: [tag],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Logged out', content: { 'application/json': { schema: envelopeOf(z.object({ ok: z.boolean() })) } } },
      ...auth,
    },
  })
  router.use('/sessions/logout', guard)
  router.openapi(logout, async (c) => {
    const p = principalOf(c)
    await sessions.logoutSession(p.userId, p.sessionId)
    return c.json(ok(c, 'Logged out', { ok: true }), 200)
  })
}
