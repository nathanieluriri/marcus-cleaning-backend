import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import type { Role } from '@/server/security/principal'
import { SocialSignInOut, SocialSignInRequest } from '@/server/schemas/social-auth'
import * as googleOauth from '@/server/services/google-oauth-service'
import { signInWithIdToken } from '@/server/services/social-account-service'

/**
 * Google OAuth routes for customer + cleaner.
 *
 * Two routers are exported and mounted separately:
 *   customerOauth → /api/v1/customers   (role 'customer')
 *   cleanerOauth  → /api/v1/cleaners    (role 'cleaner')
 *
 * Each exposes:
 *   GET  /google/auth     → 302 redirect to Google (browser/web flow)
 *   GET  /auth/callback   → exchange + issue our own tokens
 *   POST /auth/social     → NATIVE flow: exchange a Firebase/Google ID token
 *
 * The two GETs are browser redirect targets, not typed JSON endpoints, so they
 * are plain routes and documented rather than schema-generated.
 *
 * `POST /auth/social` is the one mobile should use: the app runs native Google
 * or Apple sign-in with the Firebase SDK and posts the ID token here. It is a
 * typed `.openapi` route and appears in the spec.
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

  // POST /auth/social — native ID-token exchange (Firebase / Google SDK).
  router.openapi(
    createRoute({
      method: 'post',
      path: '/auth/social',
      tags: [role === 'cleaner' ? 'Cleaners' : 'Customers'],
      summary: 'Exchange a Firebase/Google ID token for our own session',
      description:
        'Native Google and Apple sign-in. The app signs in with the Firebase SDK (or bare Google Sign-In), then posts the resulting ID token. Works on Android, iOS and web.',
      request: { body: { content: { 'application/json': { schema: SocialSignInRequest } } } },
      responses: {
        200: {
          description: 'Signed in',
          content: { 'application/json': { schema: envelopeOf(SocialSignInOut) } },
        },
        401: {
          description: 'ID token rejected',
          content: { 'application/json': { schema: ErrorEnvelope } },
        },
        422: {
          description: 'Validation error',
          content: { 'application/json': { schema: ErrorEnvelope } },
        },
      },
    }),
    async (c) => {
      const { idToken } = c.req.valid('json')
      const result = await signInWithIdToken({ role, idToken, device: deviceFrom(c) })
      return c.json(
        ok(c, 'Signed in successfully', {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenType: 'Bearer' as const,
          expiresIn: result.expiresIn,
          userId: result.userId,
          email: result.email,
          isNewUser: result.isNewUser,
          provider: result.provider,
        }),
        200,
      )
    },
  )

  return router
}

export const customerOauth = buildOauthRouter('customer')
export const cleanerOauth = buildOauthRouter('cleaner')
