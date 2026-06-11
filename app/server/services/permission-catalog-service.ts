/**
 * Permission catalog + groups. Ported from `permission_catalog_service.py`.
 * The catalog is a static list of known permission keys (the original derives
 * it from `default_role_permissions.py`). No Hono/HTTP types here.
 *
 * TODO: replace the static catalog with the exact ported permission set.
 * See: docs/migration/06-services-and-repositories.md
 */

import * as accessRepo from '@/server/repositories/admin-access-repo'

export interface PermissionEntry {
  key: string
  label: string
  category: string
}

const CATALOG: PermissionEntry[] = [
  { key: 'customers.read', label: 'View customers', category: 'directory' },
  { key: 'customers.write', label: 'Manage customers', category: 'directory' },
  { key: 'cleaners.read', label: 'View cleaners', category: 'directory' },
  { key: 'cleaners.write', label: 'Manage cleaners', category: 'directory' },
  { key: 'cleaners.onboarding.review', label: 'Review cleaner onboarding', category: 'onboarding' },
  { key: 'bookings.read', label: 'View bookings', category: 'bookings' },
  { key: 'bookings.write', label: 'Manage bookings', category: 'bookings' },
  { key: 'payments.read', label: 'View payments', category: 'payments' },
  { key: 'payments.refund', label: 'Refund payments', category: 'payments' },
  { key: 'pricing.write', label: 'Manage pricing rules', category: 'catalog' },
  { key: 'promos.write', label: 'Manage promo codes', category: 'catalog' },
  { key: 'credits.grant', label: 'Grant service credits', category: 'catalog' },
  { key: 'broadcasts.dispatch', label: 'Dispatch broadcasts', category: 'comms' },
  { key: 'claims.decide', label: 'Decide claims', category: 'ops' },
  { key: 'monitoring.read', label: 'View monitoring', category: 'monitoring' },
  { key: 'audit.export', label: 'Export audit logs', category: 'monitoring' },
  { key: 'access.elevate', label: 'Request elevation', category: 'access' },
  { key: 'access.decide', label: 'Decide access requests', category: 'access' },
  { key: 'permissions.template.write', label: 'Manage role templates', category: 'access' },
  { key: 'admins.write', label: 'Manage admins', category: 'access' },
]

export function getCatalog(): PermissionEntry[] {
  return CATALOG
}

export function listGroups(): Promise<Array<Record<string, unknown>>> {
  return accessRepo.listGroups()
}

export function createGroup(args: {
  name: string
  permissions: string[]
  extra?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  return accessRepo.createGroup({ name: args.name, permissions: args.permissions, ...(args.extra ?? {}) })
}
