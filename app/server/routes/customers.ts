import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { CustomerLogin, CustomerOut, CustomerSignupRequest } from '@/server/schemas/customer'
import { RefreshRequest, TokenResponse, readRefreshToken } from '@/server/schemas/auth'
import { z } from '@hono/zod-openapi'
import * as customerService from '@/server/services/customer-service'
import type { AppContext } from '@/server/core/http-env'
import { PasswordResetRequest, PasswordResetConfirm } from '@/server/schemas/password-reset'
import * as passwordResetService from '@/server/services/password-reset-service'

/**
 * /v1/customers — auth slice (signup / login / refresh).
 * Mounted under /api/v1/customers (see server/app.ts).
 * See: docs/migration/07-domain-endpoints.md
 */

export const customers = createRouter()

function deviceFrom(c: AppContext) {
  return {
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
  }
}

const AuthResultData = z
  .object({ customer: CustomerOut, tokens: TokenResponse })
  .openapi('CustomerAuthResult')

const commonErrors = {
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// POST /signup
const signupRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['Customers'],
  request: { body: { content: { 'application/json': { schema: CustomerSignupRequest } } } },
  responses: {
    201: { description: 'Account created', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
    409: { description: 'Email already exists', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

customers.openapi(signupRoute, async (c) => {
  const payload = c.req.valid('json')
  const r = await customerService.signup(payload, deviceFrom(c))
  return c.json(
    ok(c, 'Account created successfully', {
      customer: r.customer,
      tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language },
    }),
    201,
  )
})

// POST /login
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Customers'],
  request: { body: { content: { 'application/json': { schema: CustomerLogin } } } },
  responses: {
    200: { description: 'Login successful', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

customers.openapi(loginRoute, async (c) => {
  const payload = c.req.valid('json')
  const r = await customerService.login(payload, deviceFrom(c))
  return c.json(
    ok(c, 'Login successful', {
      customer: r.customer,
      tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language },
    }),
    200,
  )
})

// POST /refresh
const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Customers'],
  request: { body: { content: { 'application/json': { schema: RefreshRequest } } } },
  responses: {
    200: { description: 'Tokens refreshed', content: { 'application/json': { schema: envelopeOf(TokenResponse) } } },
    401: { description: 'Invalid refresh token', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

customers.openapi(refreshRoute, async (c) => {
  const body = c.req.valid('json')
  const r = await customerService.refresh(readRefreshToken(body), deviceFrom(c))
  return c.json(
    ok(c, 'Tokens refreshed successfully', {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: r.expiresIn,
      language: r.language,
    }),
    200,
  )
})

// POST /password-reset/request — always 200 (no email enumeration)
customers.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/request',
    tags: ['Customers'],
    request: { body: { content: { 'application/json': { schema: PasswordResetRequest } } } },
    responses: {
      200: { description: 'Reset requested', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      ...commonErrors,
    },
  }),
  async (c) => {
    const { email } = c.req.valid('json')
    const origin = new URL(c.req.url).origin
    await passwordResetService.requestReset(email, (token) => `${origin}/reset-password?token=${token}`)
    return c.json(ok(c, 'If that email exists, a reset link has been sent', null), 200)
  },
)

// POST /password-reset/confirm
customers.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/confirm',
    tags: ['Customers'],
    request: { body: { content: { 'application/json': { schema: PasswordResetConfirm } } } },
    responses: {
      200: { description: 'Password reset', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      400: { description: 'Invalid or expired token', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...commonErrors,
    },
  }),
  async (c) => {
    const { token, newPassword } = c.req.valid('json')
    await passwordResetService.confirmReset(token, newPassword)
    return c.json(ok(c, 'Password reset successfully', null), 200)
  },
)
