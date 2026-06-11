import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerLogin, CleanerOnboardingUpdate, CleanerOut, CleanerSignupRequest } from '@/server/schemas/cleaner'
import { RefreshRequest, TokenResponse, readRefreshToken } from '@/server/schemas/auth'
import * as cleanerService from '@/server/services/cleaner-service'
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

registerSessionRoutes(cleaners, requireCleaner(), 'Cleaners')
