import type { Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { getSettings } from '@/server/core/settings'

/**
 * httpOnly cookie sessions for the admin web frontend. Cookies mirror the
 * bearer tokens issued via `auth-session-service` — the browser never touches
 * the tokens directly. See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 */

export const ADMIN_ACCESS_COOKIE = 'admin_access'
export const ADMIN_REFRESH_COOKIE = 'admin_refresh'
// Deliberately '/api/v1', NOT '/api/v1/admins': the access cookie also has to
// reach `/api/v1/banners/*` (bannerPermissionGuard, see
// security/admin-permission-guard.ts) and any other non-/admins admin-guarded
// surface that authenticates via `accessTokenFrom(..., 'admin')`'s cookie
// fallback. Scoping it to '/api/v1/admins' would silently break those routes
// for the admin web frontend, which never sends a bearer header. The refresh
// cookie stays tightly scoped to the one endpoint that reads it.
export const ADMIN_ACCESS_COOKIE_PATH = '/api/v1'
export const ADMIN_REFRESH_COOKIE_PATH = '/api/v1/admins/refresh'

type CookieAttrs = {
  path: string
  httpOnly: true
  sameSite: 'Lax'
  secure: boolean
  maxAge: number
  domain?: string
}

function cookieAttrs(path: string, maxAge: number): CookieAttrs {
  const s = getSettings()
  const attrs: CookieAttrs = {
    path,
    httpOnly: true,
    sameSite: 'Lax',
    secure: s.NODE_ENV === 'production',
    maxAge,
  }
  if (s.ADMIN_COOKIE_DOMAIN) attrs.domain = s.ADMIN_COOKIE_DOMAIN
  return attrs
}

/** Set both admin session cookies from freshly issued tokens (login/verify-otp/refresh). */
export function setAdminSessionCookies(
  c: Context,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
): void {
  const s = getSettings()
  setCookie(c, ADMIN_ACCESS_COOKIE, tokens.accessToken, cookieAttrs(ADMIN_ACCESS_COOKIE_PATH, tokens.expiresIn))
  setCookie(c, ADMIN_REFRESH_COOKIE, tokens.refreshToken, cookieAttrs(ADMIN_REFRESH_COOKIE_PATH, s.REFRESH_TTL_WEB_SECONDS))
}

/** Clear both admin session cookies (logout) — Max-Age=0 with matching Path attributes. */
export function clearAdminSessionCookies(c: Context): void {
  const s = getSettings()
  const domainOpt = s.ADMIN_COOKIE_DOMAIN ? { domain: s.ADMIN_COOKIE_DOMAIN } : {}
  deleteCookie(c, ADMIN_ACCESS_COOKIE, { path: ADMIN_ACCESS_COOKIE_PATH, ...domainOpt })
  deleteCookie(c, ADMIN_REFRESH_COOKIE, { path: ADMIN_REFRESH_COOKIE_PATH, ...domainOpt })
}

export function readAdminAccessCookie(c: Context): string | undefined {
  return getCookie(c, ADMIN_ACCESS_COOKIE)
}

export function readAdminRefreshCookie(c: Context): string | undefined {
  return getCookie(c, ADMIN_REFRESH_COOKIE)
}
