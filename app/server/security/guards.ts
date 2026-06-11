import { createMiddleware } from 'hono/factory'
import type { Env } from '@/server/core/http-env'
import { authInvalidToken, authRoleMismatch, AppError } from '@/server/core/errors'
import { verifyAccessToken } from './jwt'
import { ROLE_TO_AUDIENCE, type AuthPrincipal, type Role } from './principal'
import { retrieveAccountById } from '@/server/services/role-account-gateway'

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

function makeGuard(role: Role) {
  const audience = ROLE_TO_AUDIENCE[role]
  return () =>
    createMiddleware<Env>(async (c, next) => {
      const token = bearer(c.req.header('Authorization'))
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

export const requireCustomer = makeGuard('customer')
export const requireCleaner = makeGuard('cleaner')
export const requireAdmin = makeGuard('admin')

/** Read the principal set by a guard (throws if missing — indicates a wiring bug). */
export function principalOf(c: Parameters<Parameters<typeof createMiddleware<Env>>[0]>[0]): AuthPrincipal {
  const p = c.get('principal')
  if (!p) throw authInvalidToken({ reason: 'Principal missing' })
  return p
}
