/**
 * Named access presets for invite-only admin creation (Task 5) and permission
 * enforcement (Task 6/7). Each preset expands to a list of permission keys in
 * the `METHOD:/api/v1/admins/...`-style format Task 7's enforcement catalog
 * consumes. `all_controls` is the super-admin preset and expands to `['*']`
 * (wildcard — matches every permission key).
 *
 * Every non-wildcard preset also carries the self-service keys every admin
 * needs regardless of role: profile, sessions, 2fa, change-password, and the
 * permissions catalog read.
 *
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md (Task 5, Task 6, Task 7)
 */

const SELF_SERVICE_PERMISSIONS = [
  'GET:/api/v1/admins/profile',
  'PATCH:/api/v1/admins/profile/language',
  'GET:/api/v1/admins/sessions',
  'DELETE:/api/v1/admins/sessions/:session_id',
  'POST:/api/v1/admins/2fa/setup',
  'POST:/api/v1/admins/2fa/verify',
  'DELETE:/api/v1/admins/2fa',
  'POST:/api/v1/admins/2fa/backup-codes/regenerate',
  'POST:/api/v1/admins/change-password',
  'GET:/api/v1/admins/permissions/catalog',
]

const OPERATIONS_PERMISSIONS = [
  'GET:/api/v1/admins/customers',
  'GET:/api/v1/admins/customers/:customer_id',
  'GET:/api/v1/admins/customers/:customer_id/places',
  'POST:/api/v1/admins/customers/:customer_id/places',
  'GET:/api/v1/admins/cleaners',
  'GET:/api/v1/admins/cleaners/:cleaner_id',
  'PATCH:/api/v1/admins/cleaners/:cleaner_id/onboarding-review',
  'GET:/api/v1/admins/onboarding/queue',
  'GET:/api/v1/bookings',
  'GET:/api/v1/bookings/:booking_id',
  'PATCH:/api/v1/bookings/:booking_id',
  'GET:/api/v1/admins/users/autocomplete',
]

const SUPPORT_PERMISSIONS = [
  'GET:/api/v1/support',
  'GET:/api/v1/support/:ticket_id',
  'PATCH:/api/v1/support/:ticket_id',
  'GET:/api/v1/faq',
  'POST:/api/v1/faq',
  'PATCH:/api/v1/faq/:faq_id',
  'GET:/api/v1/conversations',
  'GET:/api/v1/conversations/:conversation_id',
]

const CONTENT_PERMISSIONS = [
  'GET:/api/v1/banners',
  'POST:/api/v1/banners',
  'PATCH:/api/v1/banners/:banner_id',
  'DELETE:/api/v1/banners/:banner_id',
  'GET:/api/v1/promotions',
  'POST:/api/v1/promotions',
  'PATCH:/api/v1/promotions/:promotion_id',
  'DELETE:/api/v1/promotions/:promotion_id',
  'GET:/api/v1/admins/broadcasts',
  'POST:/api/v1/admins/broadcasts',
]

const FINANCE_PERMISSIONS = [
  'GET:/api/v1/payments',
  'GET:/api/v1/payments/:payment_id',
  'POST:/api/v1/payments/:payment_id/refund',
  'GET:/api/v1/admins/service-credits',
  'POST:/api/v1/admins/service-credits/grant',
  'GET:/api/v1/admins/payouts',
  'POST:/api/v1/admins/payouts/:payout_id/approve',
  'GET:/api/v1/admins/reports/users/summary',
  'GET:/api/v1/admins/reports/users/signups-trend',
]

export interface AdminPreset {
  label: string
  description: string
  permissions: string[]
}

export const ADMIN_PRESETS: Record<string, AdminPreset> = {
  all_controls: {
    label: 'All controls',
    description: 'Full super-admin access to every admin route.',
    permissions: ['*'],
  },
  operations_only: {
    label: 'Operations',
    description: 'Customers, cleaners, bookings and onboarding — reads and writes.',
    permissions: [...OPERATIONS_PERMISSIONS, ...SELF_SERVICE_PERMISSIONS],
  },
  support_only: {
    label: 'Support',
    description: 'Support tickets, FAQ and customer conversations.',
    permissions: [...SUPPORT_PERMISSIONS, ...SELF_SERVICE_PERMISSIONS],
  },
  content_support: {
    label: 'Content & support',
    description: 'Banners, promotions and broadcasts, plus support and FAQ.',
    permissions: [...CONTENT_PERMISSIONS, ...SUPPORT_PERMISSIONS, ...SELF_SERVICE_PERMISSIONS],
  },
  finance_only: {
    label: 'Finance',
    description: 'Payments, service credits, payouts and financial reports.',
    permissions: [...FINANCE_PERMISSIONS, ...SELF_SERVICE_PERMISSIONS],
  },
}

/** Expand a preset key into its permission list. Unknown keys expand to `[]` (no access). */
export function expandPreset(key: string | null | undefined): string[] {
  if (!key) return []
  const preset = ADMIN_PRESETS[key]
  return preset ? [...preset.permissions] : []
}

export interface AccessPresetCatalogItem {
  key: string
  label: string
  description: string
  permissionCount: number
}

/** Catalog of every named preset for the `GET /admins/access-presets` endpoint. */
export function listPresetsCatalog(): AccessPresetCatalogItem[] {
  return Object.entries(ADMIN_PRESETS).map(([key, preset]) => ({
    key,
    label: preset.label,
    description: preset.description,
    permissionCount: preset.permissions.length,
  }))
}

/** True when a permission list contains the wildcard (i.e. grants every permission). */
export function hasWildcard(permissions: string[] | null | undefined): boolean {
  return Array.isArray(permissions) && permissions.includes('*')
}
