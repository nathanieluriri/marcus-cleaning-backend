/**
 * Resolved caller identity placed on the request context after auth.
 * Ported from `security/principal.py` (AuthPrincipal).
 *
 * See: ../../../docs/migration/03-auth.md
 */

export type Role = 'customer' | 'cleaner' | 'admin'

export type Audience = 'admin-web' | 'customer-mobile' | 'cleaner-mobile'

export const ROLE_TO_AUDIENCE: Record<Role, Audience> = {
  admin: 'admin-web',
  customer: 'customer-mobile',
  cleaner: 'cleaner-mobile',
}

export interface AuthPrincipal {
  userId: string
  role: Role
  audience: Audience
  sessionId: string
  scopes?: string[]
}
