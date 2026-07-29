import { describe, expect, it } from 'vitest'

/**
 * Task 8 guardrail: every permission key listed in an access preset
 * (server/security/admin-presets.ts) must resolve to an actual mounted
 * route somewhere in the app — not just under /admins, across every
 * mounted router. Prevents presets from silently referencing endpoints
 * that were renamed or never existed (caught during the Task 8
 * verification pass: bogus `/support/:ticket_id`, `/faq/:faq_id`,
 * `/promotions/:promotion_id`, `/admins/payouts`, `/admins/sessions`
 * entries were removed as a result).
 */

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

function normalize(method: string, path: string): string {
  const norm = path
    .split('/')
    .map((s) => (s.startsWith(':') || (s.startsWith('{') && s.endsWith('}')) ? '*' : s))
    .join('/')
    .replace(/\/+$/, '')
  return `${method.toUpperCase()}:${norm || '/'}`
}

describe('admin preset route coverage guardrail', () => {
  it('every non-wildcard preset permission resolves to a mounted route', async () => {
    const { ADMIN_PRESETS } = await import('@/server/security/admin-presets')
    const { app } = await import('@/server/app')

    const routeKeys = new Set<string>()
    for (const r of app.routes) {
      const method = r.method.toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue
      routeKeys.add(normalize(method, r.path))
    }

    const missing: Record<string, string[]> = {}
    for (const [presetKey, preset] of Object.entries(ADMIN_PRESETS)) {
      for (const perm of preset.permissions) {
        if (perm === '*') continue
        const sep = perm.indexOf(':')
        const norm = normalize(perm.slice(0, sep), perm.slice(sep + 1))
        if (!routeKeys.has(norm)) {
          missing[presetKey] = missing[presetKey] || []
          missing[presetKey].push(perm)
        }
      }
    }

    expect(missing).toEqual({})
  })

  it('every admin-mount or banner-write preset permission is actually enforceable', async () => {
    // Final-review fix: presets must not contain keys that resolve to a
    // route but that no enforcement layer will ever check — e.g. the old
    // `POST /api/v1/payments/:payment_id/refund` and `GET /api/v1/conversations`
    // entries pointed at real, `requireCustomer()`-guarded routes an admin
    // token can never reach. This asserts the two domains that DO have
    // mount-level enforcement (the /admins mount, and banner writes since
    // this fix) are fully covered for every preset that grants them.
    const { ADMIN_PRESETS } = await import('@/server/security/admin-presets')
    const {
      isExemptAdminRoute,
      isImplicitSelfService,
      matchAdminRouteKey,
      matchBannerRouteKey,
      ADMIN_MOUNT,
      BANNERS_MOUNT,
    } = await import('@/server/security/admin-permission-guard')

    const unenforceable: Record<string, string[]> = {}
    for (const [presetKey, preset] of Object.entries(ADMIN_PRESETS)) {
      for (const perm of preset.permissions) {
        if (perm === '*') continue
        const sep = perm.indexOf(':')
        const method = perm.slice(0, sep)
        const path = perm.slice(sep + 1)

        let enforceable = true
        if (path.startsWith(ADMIN_MOUNT)) {
          const rel = path.slice(ADMIN_MOUNT.length) || '/'
          enforceable =
            isExemptAdminRoute(method, rel) ||
            isImplicitSelfService(method, rel) ||
            matchAdminRouteKey(method, path) !== null
        } else if (path.startsWith(BANNERS_MOUNT) && method.toUpperCase() !== 'GET') {
          enforceable = matchBannerRouteKey(method, path) !== null
        }
        // Any other domain (customer-guarded reads like faq/promotions/payments/
        // banner-GET) has no admin-mount enforcement layer at all — those are
        // intentionally left out of this strict check; see the coverage test
        // above for "resolves to a real route" instead.

        if (!enforceable) {
          unenforceable[presetKey] = unenforceable[presetKey] || []
          unenforceable[presetKey].push(perm)
        }
      }
    }

    expect(unenforceable).toEqual({})
  })
})
