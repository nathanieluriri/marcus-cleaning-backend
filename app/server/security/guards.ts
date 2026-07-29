import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { Env } from '@/server/core/http-env'
import { authInvalidToken, authRoleMismatch, AppError } from '@/server/core/errors'
import { verifyAccessToken } from './jwt'
import { ROLE_TO_AUDIENCE, type AuthPrincipal, type Role } from './principal'
import { retrieveAccountById } from '@/server/services/role-account-gateway'
import { ADMIN_ACCESS_COOKIE } from '@/server/security/admin-cookies'

/**
 * Route guard middleware: verify the bearer access token for the role's
 * audience, load the account, enforce account status, attach the principal.
 * Ported from the `verify_*_token` dependencies in `security/auth.py`.
 * See: docs/migration/04-api-layer.md
 */

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) throw authInvalidToken({ reason: 'Missing bearer token' })
  return authHeader.slice(7)
}

/**
 * Resolve the access token for a guarded request: bearer header first, and —
 * for the admin role only — the `admin_access` httpOnly cookie as a fallback
 * (the admin web frontend authenticates via cookie, not a stored token).
 */
export function accessTokenFrom(c: Parameters<Parameters<typeof createMiddleware<Env>>[0]>[0], role: Role): string {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  if (role === 'admin') {
    const cookieToken = getCookie(c, ADMIN_ACCESS_COOKIE)
    if (cookieToken) return cookieToken
  }
  throw authInvalidToken({ reason: 'Missing bearer token' })
}

function makeGuard(role: Role) {
  const audience = ROLE_TO_AUDIENCE[role]
  return () =>
    createMiddleware<Env>(async (c, next) => {
      // Idempotent: when a mount-level guard (admin-permission-guard) has
      // already authenticated the request and set a principal of the right
      // role, skip re-verifying — the token/account were checked once already.
      const existing = c.get('principal')
      if (existing && existing.role === role) {
        await next()
        return
      }
      const token = accessTokenFrom(c, role)
      const claims = await verifyAccessToken(token, audience)
      if (claims.role !== role) throw authRoleMismatch(role, claims.role)

      const account = await retrieveAccountById(role, claims.sub)
      if (!account) throw authInvalidToken({ reason: 'Account not found' })
      // Non-admin accounts must be ACTIVE (parity with account_status_check.py).
      if (role !== 'admin' && account.accountStatus !== 'ACTIVE') {
        throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Account is not active', {
          accountStatus: account.accountStatus,
        })
      }

      const principal: AuthPrincipal = {
        userId: claims.sub,
        role: claims.role,
        audience: claims.audience,
        sessionId: claims.sessionId,
      }
      c.set('principal', principal)
      await next()
    })
}

/**
 * Guard accepting EITHER a customer or a cleaner access token, for endpoints
 * both apps share (booking reads, chat, device registration). Each candidate
 * audience is tried in turn; downstream code narrows visibility by role.
 */
export function requireAnyOf(...roles: Role[]) {
  return () =>
    createMiddleware<Env>(async (c, next) => {
      const token = bearer(c.req.header('Authorization'))

      let principal: AuthPrincipal | null = null
      let lastErr: unknown = null
      for (const role of roles) {
        try {
          const claims = await verifyAccessToken(token, ROLE_TO_AUDIENCE[role])
          if (claims.role !== role) continue
          const account = await retrieveAccountById(role, claims.sub)
          if (!account) throw authInvalidToken({ reason: 'Account not found' })
          if (role !== 'admin' && account.accountStatus !== 'ACTIVE') {
            throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Account is not active', {
              accountStatus: account.accountStatus,
            })
          }
          principal = {
            userId: claims.sub,
            role: claims.role,
            audience: claims.audience,
            sessionId: claims.sessionId,
          }
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!principal) {
        throw lastErr ?? authInvalidToken({ reason: `Token not valid for ${roles.join(' or ')}` })
      }
      c.set('principal', principal)
      await next()
    })
}

export const requireCustomerOrCleaner = requireAnyOf('customer', 'cleaner')

export const requireCustomer = makeGuard('customer')
export const requireCleaner = makeGuard('cleaner')
export const requireAdmin = makeGuard('admin')

/** Read the principal set by a guard (throws if missing — indicates a wiring bug). */
export function principalOf(c: Parameters<Parameters<typeof createMiddleware<Env>>[0]>[0]): AuthPrincipal {
  const p = c.get('principal')
  if (!p) throw authInvalidToken({ reason: 'Principal missing' })
  return p
}
