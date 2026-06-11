import type { RequestIdVariables } from 'hono/request-id'
import type { Context } from 'hono'
import type { AuthPrincipal } from '@/server/security/principal'

/**
 * Shared Hono environment type. Kept in its own module so middleware and the
 * app builder can both import it without a circular dependency.
 */

export type Locale = 'en' | 'fr'

export type AppVariables = RequestIdVariables & {
  principal: AuthPrincipal | null
  locale: Locale
}

export type Env = { Variables: AppVariables }

export type AppContext = Context<Env>
