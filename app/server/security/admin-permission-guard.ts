import { createMiddleware } from 'hono/factory'
import type { Env } from '@/server/core/http-env'
import { AppError, authInvalidToken, authRoleMismatch } from '@/server/core/errors'
import { verifyAccessToken } from './jwt'
import { ROLE_TO_AUDIENCE, type AuthPrincipal } from './principal'
import { accessTokenFrom } from './guards'
import { hasWildcard } from './admin-presets'
import * as adminRepo from '@/server/repositories/admin-repo'
import { admins } from '@/server/routes/admins'
import { adminCore } from '@/server/routes/admin-core'
import { adminFeatures } from '@/server/routes/admin-features'
import { adminSafety } from '@/server/routes/admin-safety'
import { adminBroadcasts } from '@/server/routes/admin-broadcasts'

/**
 * Mount-level permission enforcement for every admin route (Task 7).
 *
 * Mounted in `app.ts` on `/api/v1/admins/*` BEFORE the admin routers and AFTER
 * rate-limit. Flow per request:
 *
 *   1. EXEMPT paths (login, verify-otp, refresh, OPTIONS) skip everything.
 *   2. Authenticate with `requireAdmin` semantics (bearer or admin cookie),
 *      loading the full admin doc once; sets the principal so downstream
 *      per-route `requireAdmin()` calls become idempotent no-ops.
 *   3. `mustChangePassword` lockdown: only change-password, GET /profile,
 *      sessions routes and POST /logout are allowed (403 PASSWORD_CHANGE_REQUIRED).
 *   4. Permission check against the catalog derived from the mounted admin
 *      route tables. Fail closed: an uncatalogued path is 403 FORBIDDEN.
 *
 * Enforcement rule (carry-forward decision): access is granted when
 * `admin.isSuperAdmin === true` OR the permissionList contains `'*'`. The
 * `isSuperAdmin` flag deliberately SURVIVES a preset downgrade — downgrading
 * a super admin's accessPreset does not strip super-admin powers; only
 * flipping `isSuperAdmin` off does. This is by design, not an oversight.
 *
 * Self-service routes (profile, sessions, 2fa, change-password, logout,
 * permission catalog, access-presets, elevation request/status) are implicitly
 * allowed for ANY authenticated admin and never permission-gated.
 */

export const ADMIN_MOUNT = '/api/v1/admins'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** Routes reachable without authentication (relative to the admin mount). */
const EXEMPT = new Set(['POST:/login', 'POST:/verify-otp', 'POST:/refresh'])

interface RouteRule {
  method: string // '*' = any method
  path: string // relative to ADMIN_MOUNT
  prefix?: boolean // true: match the path and anything nested under it
}

/** Self-service surface every authenticated admin implicitly holds. */
const IMPLICIT_SELF_SERVICE: RouteRule[] = [
  { method: 'GET', path: '/profile' },
  { method: 'GET', path: '/profile/language' },
  { method: 'PATCH', path: '/profile/language' },
  { method: 'POST', path: '/logout' },
  { method: 'POST', path: '/change-password' },
  { method: 'GET', path: '/permissions/catalog' },
  { method: 'GET', path: '/access-presets' },
  { method: 'POST', path: '/access/request-elevation' },
  { method: 'GET', path: '/access/request-elevation/status' },
  { method: '*', path: '/sessions', prefix: true },
  { method: '*', path: '/2fa', prefix: true },
]

/** The only routes usable while `mustChangePassword` is set. */
const PASSWORD_GATE_ALLOWED: RouteRule[] = [
  { method: 'POST', path: '/change-password' },
  { method: 'GET', path: '/profile' },
  { method: 'POST', path: '/logout' },
  { method: '*', path: '/sessions', prefix: true },
]

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path
}

function isPlaceholder(segment: string): boolean {
  return segment.startsWith(':') || (segment.startsWith('{') && segment.endsWith('}'))
}

/** `:param` → `{param}` (display/catalog form). */
function displaySegment(segment: string): string {
  if (segment.startsWith(':')) return `{${segment.slice(1)}}`
  return segment
}

function displayPath(path: string): string {
  return trimTrailingSlash(path).split('/').map(displaySegment).join('/')
}

/**
 * Canonical comparison form of a permission key: uppercase method, any
 * `:param` / `{param}` segment collapsed to `*` (names don't matter).
 */
export function normalizePermissionKey(key: string): string {
  const sep = key.indexOf(':')
  if (sep < 0) return key
  const method = key.slice(0, sep).toUpperCase()
  const path = trimTrailingSlash(key.slice(sep + 1))
  const norm = path
    .split('/')
    .map((s) => (isPlaceholder(s) ? '*' : s))
    .join('/')
  return `${method}:${norm}`
}

function matchesRule(method: string, relPath: string, rule: RouteRule): boolean {
  if (rule.method !== '*' && rule.method !== method) return false
  if (rule.prefix) return relPath === rule.path || relPath.startsWith(`${rule.path}/`)
  return relPath === rule.path
}

/** True for the unauthenticated admin surface (relative path). */
export function isExemptAdminRoute(method: string, relPath: string): boolean {
  return EXEMPT.has(`${method.toUpperCase()}:${trimTrailingSlash(relPath)}`)
}

/** True when any authenticated admin may hit the route (relative path). */
export function isImplicitSelfService(method: string, relPath: string): boolean {
  const m = method.toUpperCase()
  const p = trimTrailingSlash(relPath)
  return IMPLICIT_SELF_SERVICE.some((rule) => matchesRule(m, p, rule))
}

function allowedDuringPasswordGate(method: string, relPath: string): boolean {
  const p = trimTrailingSlash(relPath)
  return PASSWORD_GATE_ALLOWED.some((rule) => matchesRule(method, p, rule))
}

type RouterLike = { routes: Array<{ method: string; path: string }> }

// Accessed lazily (inside getAdminRouteKeys) so the router modules — some of
// which transitively import this module's consumers — are fully initialised
// by the time we walk their route tables (ESM live bindings).
function adminRouters(): RouterLike[] {
  return [admins, adminCore, adminFeatures, adminSafety, adminBroadcasts]
}

let cachedKeys: string[] | null = null

/**
 * Every registered admin route as a catalog key
 * `METHOD:/api/v1/admins/<path with {param} placeholders>`, deduped, derived
 * from the mounted routers' route tables. Cached at module level.
 */
export function getAdminRouteKeys(): string[] {
  if (!cachedKeys) {
    const seen = new Set<string>()
    for (const router of adminRouters()) {
      for (const route of router.routes) {
        const method = route.method.toUpperCase()
        if (!METHODS.has(method)) continue // skip middleware ('ALL') entries
        const rel = route.path === '/' ? '' : route.path
        seen.add(`${method}:${displayPath(ADMIN_MOUNT + rel)}`)
      }
    }
    cachedKeys = [...seen].sort()
  }
  return cachedKeys
}

/** Test seam: rebuild the derived catalog. */
export function __resetAdminRouteCatalog(): void {
  cachedKeys = null
}

function segmentsMatch(patternSegs: string[], pathSegs: string[]): boolean {
  if (patternSegs.length !== pathSegs.length) return false
  return patternSegs.every((seg, i) => isPlaceholder(seg) || seg === pathSegs[i])
}

/**
 * Resolve a concrete request (method + full path) to its catalog key.
 * Longest match wins: among candidates with the same segment count, the one
 * with the most literal (non-placeholder) segments. Returns null when no
 * catalog entry matches (callers fail closed).
 */
export function matchAdminRouteKey(method: string, path: string): string | null {
  const m = method.toUpperCase()
  const pathSegs = trimTrailingSlash(path).split('/')
  let best: string | null = null
  let bestLiterals = -1
  for (const key of getAdminRouteKeys()) {
    if (!key.startsWith(`${m}:`)) continue
    const patternSegs = key.slice(m.length + 1).split('/')
    if (!segmentsMatch(patternSegs, pathSegs)) continue
    const literals = patternSegs.filter((s) => !isPlaceholder(s)).length
    if (literals > bestLiterals) {
      best = key
      bestLiterals = literals
    }
  }
  return best
}

/**
 * The enforcement middleware. See the module doc-comment for the full flow.
 */
export function adminPermissionGuard() {
  return createMiddleware<Env>(async (c, next) => {
    const method = c.req.method.toUpperCase()
    if (method === 'OPTIONS') return next()

    const path = trimTrailingSlash(c.req.path)
    if (path !== ADMIN_MOUNT && !path.startsWith(`${ADMIN_MOUNT}/`)) return next()
    const relPath = path.slice(ADMIN_MOUNT.length) || '/'

    if (isExemptAdminRoute(method, relPath)) return next()

    // --- authenticate (requireAdmin semantics; loads the admin doc once) ---
    const token = accessTokenFrom(c, 'admin')
    const claims = await verifyAccessToken(token, ROLE_TO_AUDIENCE.admin)
    if (claims.role !== 'admin') throw authRoleMismatch('admin', claims.role)
    const admin = await adminRepo.findById(claims.sub)
    if (!admin) throw authInvalidToken({ reason: 'Account not found' })

    const principal: AuthPrincipal = {
      userId: claims.sub,
      role: claims.role,
      audience: claims.audience,
      sessionId: claims.sessionId,
    }
    c.set('principal', principal) // downstream requireAdmin() becomes a no-op

    // --- mustChangePassword lockdown ---
    if (admin.mustChangePassword && !allowedDuringPasswordGate(method, relPath)) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required before using the admin API')
    }

    // --- permission check ---
    // Carry-forward decision: isSuperAdmin survives preset downgrade (by
    // design) — the flag alone grants everything, as does a '*' wildcard.
    if (admin.isSuperAdmin === true || hasWildcard(admin.permissionList)) return next()

    if (isImplicitSelfService(method, relPath)) return next()

    const key = matchAdminRouteKey(method, path)
    if (!key) {
      // Fail closed: a request under the admin mount that matches no
      // catalogued route is forbidden, not 404.
      throw new AppError(403, 'FORBIDDEN', 'Forbidden')
    }
    const wanted = normalizePermissionKey(key)
    const granted = (admin.permissionList ?? []).map(normalizePermissionKey)
    if (!granted.includes(wanted)) {
      throw new AppError(403, 'FORBIDDEN', 'Forbidden', { required: key })
    }
    await next()
  })
}
