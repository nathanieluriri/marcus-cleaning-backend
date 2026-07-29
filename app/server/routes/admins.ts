import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { requireAdmin, principalOf } from '@/server/security/guards'
import {
  setAdminSessionCookies,
  clearAdminSessionCookies,
  readAdminRefreshCookie,
} from '@/server/security/admin-cookies'
import {
  AdminLogin,
  AdminOut,
  AdminLoginChallengeData,
  AdminVerifyOtpRequest,
  AdminChangePasswordRequest,
  TotpSetupData,
  TotpVerifyRequest,
  TotpBackupCodesData,
  TotpDisableRequest,
  TotpRegenerateBackupCodesRequest,
} from '@/server/schemas/admin'
import { TokenResponse } from '@/server/schemas/auth'
import { authInvalidToken } from '@/server/core/errors'
import * as adminService from '@/server/services/admin-service'
import * as adminOtpService from '@/server/services/admin-otp-service'
import * as adminTotpService from '@/server/services/admin-totp-service'
import * as sessions from '@/server/services/auth-session-service'
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

/**
 * Browser (cookie) clients never need tokens in the body; curl/tests opt in
 * via this header. Keeps the response body lean while preserving a raw-token
 * escape hatch for tooling that can't read httpOnly cookies.
 */
function includeTokens(c: AppContext): boolean {
  return c.req.header('X-Auth-Include-Tokens') === '1'
}

const AuthResultData = z.object({ admin: AdminOut, tokens: TokenResponse.nullable() }).openapi('AdminAuthResult')
const LoginResponseData = z.union([AuthResultData, AdminLoginChallengeData]).openapi('AdminLoginResponse')
/** Loose refresh body — both fields optional; the handler falls back to the `admin_refresh` cookie. */
const AdminRefreshRequest = z
  .object({ refreshToken: z.string().optional(), refresh_token: z.string().optional() })
  .openapi('AdminRefreshRequest')
const errs = {
  401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

admins.openapi(
  createRoute({
    method: 'post',
    path: '/login',
    tags: ['Admins'],
    description:
      'When ADMIN_OTP_REQUIRED is true (default), responds with an OTP challenge — no tokens, no profile — instead of tokens. Complete login via POST /admins/verify-otp.',
    request: { body: { content: { 'application/json': { schema: AdminLogin } } } },
    responses: {
      200: {
        description: 'Login successful (tokens) or an OTP challenge was issued',
        content: { 'application/json': { schema: envelopeOf(LoginResponseData) } },
      },
      ...errs,
    },
  }),
  async (c) => {
    const r = await adminService.login(c.req.valid('json'), deviceFrom(c))
    if ('otpRequired' in r) {
      return c.json(ok(c, 'OTP verification required', r), 200)
    }
    setAdminSessionCookies(c, r)
    return c.json(ok(c, 'Login successful', { admin: r.admin, tokens: includeTokens(c) ? tokens(r) : null }), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'post',
    path: '/verify-otp',
    tags: ['Admins'],
    request: { body: { content: { 'application/json': { schema: AdminVerifyOtpRequest } } } },
    responses: {
      200: { description: 'OTP verified — login complete', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
      401: { description: 'Invalid, expired, or already-consumed code', content: { 'application/json': { schema: ErrorEnvelope } } },
      429: { description: 'Too many failed attempts', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const r = await adminOtpService.verifyChallenge({
      challengeId: body.challengeId,
      code: body.code,
      device: deviceFrom(c),
    })
    setAdminSessionCookies(c, r)
    return c.json(ok(c, 'Login successful', { admin: r.admin, tokens: includeTokens(c) ? tokens(r) : null }), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Admins'],
    description: 'Reads the refresh token from the request body, or falls back to the admin_refresh cookie.',
    request: { body: { content: { 'application/json': { schema: AdminRefreshRequest } } } },
    responses: {
      200: { description: 'Tokens refreshed', content: { 'application/json': { schema: envelopeOf(TokenResponse.nullable()) } } },
      ...errs,
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const presented = body.refreshToken ?? body.refresh_token ?? readAdminRefreshCookie(c)
    if (!presented) throw authInvalidToken({ reason: 'Missing refresh token' })
    const r = await adminService.refresh(presented, deviceFrom(c))
    setAdminSessionCookies(c, r)
    return c.json(ok(c, 'Tokens refreshed successfully', includeTokens(c) ? tokens(r) : null), 200)
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

admins.use('/2fa/*', requireAdmin())

admins.openapi(
  createRoute({
    method: 'post',
    path: '/2fa/setup',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description: 'Begin (or restart) TOTP enrollment — stores a pending secret, returns it plus a QR-ready otpauth URI.',
    responses: {
      200: { description: 'Pending TOTP secret issued', content: { 'application/json': { schema: envelopeOf(TotpSetupData) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const result = await adminTotpService.setup(p.userId)
    return c.json(ok(c, 'TOTP setup initiated', result), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'post',
    path: '/2fa/verify',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description: 'Confirm TOTP enrollment with a code from the authenticator app. On success, TOTP is enabled and 8 backup codes are returned (plaintext, once).',
    request: { body: { content: { 'application/json': { schema: TotpVerifyRequest } } } },
    responses: {
      200: { description: 'TOTP enabled', content: { 'application/json': { schema: envelopeOf(TotpBackupCodesData) } } },
      400: { description: 'No pending TOTP setup', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Invalid code / unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { code } = c.req.valid('json')
    const result = await adminTotpService.verify(p.userId, code)
    return c.json(ok(c, 'TOTP enabled', result), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'delete',
    path: '/2fa',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description: 'Disable TOTP — accepts a live TOTP or backup code. Clears the secret and all backup codes.',
    request: { body: { content: { 'application/json': { schema: TotpDisableRequest } } } },
    responses: {
      200: { description: 'TOTP disabled', content: { 'application/json': { schema: envelopeOf(z.object({})) } } },
      400: { description: 'TOTP not enabled', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Invalid code / unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { code } = c.req.valid('json')
    await adminTotpService.disable(p.userId, code)
    return c.json(ok(c, 'TOTP disabled', {}), 200)
  },
)

admins.openapi(
  createRoute({
    method: 'post',
    path: '/2fa/backup-codes/regenerate',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description: 'Invalidate all existing backup codes and mint a fresh set (plaintext returned once).',
    request: { body: { content: { 'application/json': { schema: TotpRegenerateBackupCodesRequest } } } },
    responses: {
      200: { description: 'Backup codes regenerated', content: { 'application/json': { schema: envelopeOf(TotpBackupCodesData) } } },
      400: { description: 'TOTP not enabled', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Invalid code / unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { code } = c.req.valid('json')
    const result = await adminTotpService.regenerateBackupCodes(p.userId, code)
    return c.json(ok(c, 'Backup codes regenerated', result), 200)
  },
)

admins.use('/logout', requireAdmin())
admins.openapi(
  createRoute({
    method: 'post',
    path: '/logout',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description: 'Revokes the current session and clears the admin_access/admin_refresh cookies.',
    responses: {
      200: { description: 'Logged out', content: { 'application/json': { schema: envelopeOf(z.object({ ok: z.boolean() })) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    await sessions.logoutSession(p.userId, p.sessionId)
    clearAdminSessionCookies(c)
    return c.json(ok(c, 'Logged out', { ok: true }), 200)
  },
)

admins.use('/change-password', requireAdmin())
admins.openapi(
  createRoute({
    method: 'post',
    path: '/change-password',
    tags: ['Admins'],
    security: [{ bearerAuth: [] }],
    description:
      'Change the caller’s own password (verifies currentPassword). Clears mustChangePassword/tempPasswordExpiresAt and revokes every OTHER session. Exempt from the mustChangePassword gate.',
    request: { body: { content: { 'application/json': { schema: AdminChangePasswordRequest } } } },
    responses: {
      200: { description: 'Password changed', content: { 'application/json': { schema: envelopeOf(z.object({ ok: z.boolean() })) } } },
      401: { description: 'Unauthorized / wrong current password', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const body = c.req.valid('json')
    await adminService.changePassword(p.userId, body, p.sessionId)
    return c.json(ok(c, 'Password changed', { ok: true }), 200)
  },
)

registerSessionRoutes(admins, requireAdmin(), 'Admins')
