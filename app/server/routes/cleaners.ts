import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerLogin, CleanerOnboardingUpdate, CleanerOut, CleanerSignupRequest } from '@/server/schemas/cleaner'
import { RefreshRequest, TokenResponse, readRefreshToken } from '@/server/schemas/auth'
import { PasswordResetRequest, PasswordResetConfirm } from '@/server/schemas/password-reset'
import * as cleanerService from '@/server/services/cleaner-service'
import * as passwordResetService from '@/server/services/password-reset-service'
import { getSettings } from '@/server/core/settings'
import { registerSessionRoutes } from './_session-routes'

/** /v1/cleaners — auth + onboarding + sessions. See docs/migration/07. */

export const cleaners = createRouter()

function deviceFrom(c: AppContext) {
  return {
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
  }
}

const AuthResultData = z.object({ cleaner: CleanerOut, tokens: TokenResponse }).openapi('CleanerAuthResult')
const errs = {
  401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

function tokens(r: { accessToken: string; refreshToken: string; expiresIn: number; language: 'en' | 'fr' }) {
  return { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language }
}

cleaners.openapi(
  createRoute({
    method: 'post',
    path: '/signup',
    tags: ['Cleaners'],
    request: { body: { content: { 'application/json': { schema: CleanerSignupRequest } } } },
    responses: {
      201: { description: 'Account created', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
      409: { description: 'Email exists', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const r = await cleanerService.signup(c.req.valid('json'), deviceFrom(c))
    return c.json(ok(c, 'Account created successfully', { cleaner: r.cleaner, tokens: tokens(r) }), 201)
  },
)

cleaners.openapi(
  createRoute({
    method: 'post',
    path: '/login',
    tags: ['Cleaners'],
    request: { body: { content: { 'application/json': { schema: CleanerLogin } } } },
    responses: {
      200: { description: 'Login successful', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
      ...errs,
    },
  }),
  async (c) => {
    const r = await cleanerService.login(c.req.valid('json'), deviceFrom(c))
    return c.json(ok(c, 'Login successful', { cleaner: r.cleaner, tokens: tokens(r) }), 200)
  },
)

cleaners.openapi(
  createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Cleaners'],
    request: { body: { content: { 'application/json': { schema: RefreshRequest } } } },
    responses: {
      200: { description: 'Tokens refreshed', content: { 'application/json': { schema: envelopeOf(TokenResponse) } } },
      ...errs,
    },
  }),
  async (c) => {
    const r = await cleanerService.refresh(readRefreshToken(c.req.valid('json')), deviceFrom(c))
    return c.json(ok(c, 'Tokens refreshed successfully', tokens(r)), 200)
  },
)

cleaners.use('/onboarding', requireCleaner())
cleaners.openapi(
  createRoute({
    method: 'put',
    path: '/onboarding',
    tags: ['Cleaners'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: CleanerOnboardingUpdate } } } },
    responses: {
      200: { description: 'Onboarding updated', content: { 'application/json': { schema: envelopeOf(CleanerOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const updated = await cleanerService.updateOnboarding(p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Onboarding updated successfully', updated), 200)
  },
)

// POST /password-reset/request — always 200 (no email enumeration)
cleaners.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/request',
    tags: ['Cleaners'],
    request: { body: { content: { 'application/json': { schema: PasswordResetRequest } } } },
    responses: {
      200: { description: 'Reset requested', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { email } = c.req.valid('json')
    // Trusted, server-configured base URL — never the request Host (prevents reset-link poisoning).
    const base = getSettings().PUBLIC_APP_URL.replace(/\/$/, '')
    await passwordResetService.requestReset('cleaner', email, (token) => `${base}/reset-password?token=${token}`)
    return c.json(ok(c, 'If that email exists, a reset link has been sent', null), 200)
  },
)

// POST /password-reset/confirm
cleaners.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/confirm',
    tags: ['Cleaners'],
    request: { body: { content: { 'application/json': { schema: PasswordResetConfirm } } } },
    responses: {
      200: { description: 'Password reset', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      400: { description: 'Invalid or expired token', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { token, newPassword } = c.req.valid('json')
    await passwordResetService.confirmReset('cleaner', token, newPassword)
    return c.json(ok(c, 'Password reset successfully', null), 200)
  },
)

registerSessionRoutes(cleaners, requireCleaner(), 'Cleaners')
