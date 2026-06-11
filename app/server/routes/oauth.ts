import { createRouter } from '@/server/core/router'
import { ok } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import type { Role } from '@/server/security/principal'
import * as googleOauth from '@/server/services/google-oauth-service'

/**
 * Google OAuth routes for customer + cleaner.
 *
 * Two routers are exported and mounted separately:
 *   customerOauth → /api/v1/customers   (role 'customer')
 *   cleanerOauth  → /api/v1/cleaners    (role 'cleaner')
 *
 * Each exposes:
 *   GET /google/auth     → 302 redirect to Google
 *   GET /auth/callback   → exchange + issue our own tokens
 *
 * These are plain routes (not `.openapi`) so they stay out of the public spec —
 * they are browser redirect targets, not typed JSON API endpoints.
 *
 * See: docs/migration/03-auth.md (Google OAuth), 07-domain-endpoints.md
 */

function deviceFrom(c: AppContext) {
  return {
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
  }
}

function buildOauthRouter(role: Role) {
  const router = createRouter()

  // GET /google/auth — start the flow: redirect the browser to Google.
  router.get('/google/auth', async (c) => {
    const { url } = await googleOauth.buildAuthUrl(role)
    return c.redirect(url, 302)
  })

  // GET /auth/callback — Google redirects here with ?code&state.
  router.get('/auth/callback', async (c) => {
    const code = c.req.query('code') ?? ''
    const state = c.req.query('state') ?? ''
    const issued = await googleOauth.handleCallback({ role, code, state, device: deviceFrom(c) })

    // Return the token envelope directly for simplicity. The mobile apps consume
    // this via a deep link / custom-scheme redirect; a web flow could instead
    // 302 to SUCCESS_PAGE_URL with the tokens appended.
    return c.json(
      ok(c, 'Authenticated with Google', {
        tokens: {
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          tokenType: 'Bearer' as const,
          expiresIn: issued.expiresIn,
        },
        userId: issued.userId,
        email: issued.email,
      }),
      200,
    )
  })

  return router
}

export const customerOauth = buildOauthRouter('customer')
export const cleanerOauth = buildOauthRouter('cleaner')
