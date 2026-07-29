import { describe, expect, it } from 'vitest'

/**
 * Task 7 guardrail: every route registered on any admin router must be
 * accounted for by the enforcement middleware — either EXEMPT (public auth
 * surface), implicitly self-service, or resolvable to a catalog permission
 * key. Adding an admin route that slips through none of these buckets makes
 * this test fail (which is the point: no uncatalogued admin surface).
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

import { admins } from '@/server/routes/admins'
import { adminCore } from '@/server/routes/admin-core'
import { adminFeatures } from '@/server/routes/admin-features'
import { adminSafety } from '@/server/routes/admin-safety'
import { adminBroadcasts } from '@/server/routes/admin-broadcasts'
import {
  ADMIN_MOUNT,
  getAdminRouteKeys,
  matchAdminRouteKey,
  isExemptAdminRoute,
  isImplicitSelfService,
} from '@/server/security/admin-permission-guard'
import { getCatalog } from '@/server/services/permission-catalog-service'

const ROUTERS: Record<string, { routes: Array<{ method: string; path: string }> }> = {
  admins,
  adminCore,
  adminFeatures,
  adminSafety,
  adminBroadcasts,
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** Substitute `:param` / `{param}` with a concrete segment, as a request would look. */
function concretePath(path: string): string {
  return path
    .split('/')
    .map((s) => (s.startsWith(':') || (s.startsWith('{') && s.endsWith('}')) ? 'x-concrete' : s))
    .join('/')
}

describe('admin route coverage guardrail', () => {
  const endpoints: Array<{ router: string; method: string; path: string }> = []
  for (const [name, router] of Object.entries(ROUTERS)) {
    for (const route of router.routes) {
      const method = route.method.toUpperCase()
      if (!METHODS.has(method)) continue
      endpoints.push({ router: name, method, path: route.path === '/' ? '' : route.path })
    }
  }

  it('found a plausible number of admin endpoints', () => {
    expect(endpoints.length).toBeGreaterThan(50)
  })

  it('every admin route is exempt, self-service, or resolvable to a catalog key', () => {
    const uncovered: string[] = []
    for (const { router, method, path } of endpoints) {
      const rel = concretePath(path) || '/'
      const full = ADMIN_MOUNT + rel
      const covered =
        isExemptAdminRoute(method, rel) ||
        isImplicitSelfService(method, rel) ||
        matchAdminRouteKey(method, full) !== null
      if (!covered) uncovered.push(`${router}: ${method}:${path}`)
    }
    expect(uncovered).toEqual([])
  })

  it('the permission catalog service serves the derived catalog with labels', () => {
    const catalog = getCatalog()
    const keys = new Set(catalog.map((e) => e.key))
    for (const key of getAdminRouteKeys()) {
      expect(keys.has(key)).toBe(true)
    }
    for (const entry of catalog) {
      expect(entry.key).toMatch(/^(GET|POST|PUT|PATCH|DELETE):\/api\/v1\/admins/)
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.category.length).toBeGreaterThan(0)
    }
    // static-catalog label overrides survive
    const customers = catalog.find((e) => e.key === 'GET:/api/v1/admins/customers')
    expect(customers?.label).toBe('View customers')
    expect(customers?.category).toBe('directory')
  })
})
