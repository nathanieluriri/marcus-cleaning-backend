/**
 * Permission catalog + groups. The catalog is DERIVED from the mounted admin
 * routers' route tables (see `security/admin-permission-guard.ts`) so it can
 * never drift from what the enforcement middleware actually gates. Keys are
 * `METHOD:/api/v1/admins/<path with {param} placeholders>`. The old static
 * catalog survives as human-label overrides for well-known routes.
 * No Hono/HTTP types here.
 */

import * as accessRepo from '@/server/repositories/admin-access-repo'
import { getAdminRouteKeys, ADMIN_MOUNT } from '@/server/security/admin-permission-guard'

export interface PermissionEntry {
  key: string
  label: string
  category: string
}

/** Human labels carried over from the previous static catalog. */
const LABEL_OVERRIDES: Record<string, { label: string; category: string }> = {
  'GET:/api/v1/admins/customers': { label: 'View customers', category: 'directory' },
  'GET:/api/v1/admins/customers/{customer_id}': { label: 'View customer', category: 'directory' },
  'POST:/api/v1/admins/customers/{customer_id}/places': { label: 'Manage customers', category: 'directory' },
  'GET:/api/v1/admins/cleaners': { label: 'View cleaners', category: 'directory' },
  'GET:/api/v1/admins/cleaners/{cleaner_id}': { label: 'View cleaner', category: 'directory' },
  'PATCH:/api/v1/admins/cleaners/{cleaner_id}/onboarding-review': {
    label: 'Review cleaner onboarding',
    category: 'onboarding',
  },
  'POST:/api/v1/admins/service-credits/grant': { label: 'Grant service credits', category: 'catalog' },
  'POST:/api/v1/admins/broadcasts/dispatch': { label: 'Dispatch broadcasts', category: 'comms' },
  'POST:/api/v1/admins/claim-reviews/{id}/decision': { label: 'Decide claims', category: 'ops' },
  'GET:/api/v1/admins/monitoring/overview': { label: 'View monitoring', category: 'monitoring' },
  'POST:/api/v1/admins/monitoring/audit/export': { label: 'Export audit logs', category: 'monitoring' },
  'POST:/api/v1/admins/access/request-elevation': { label: 'Request elevation', category: 'access' },
  'PATCH:/api/v1/admins/access/requests/{request_id}/decision': {
    label: 'Decide access requests',
    category: 'access',
  },
  'PUT:/api/v1/admins/permission-templates/{role}': { label: 'Manage role templates', category: 'access' },
  'POST:/api/v1/admins/invites': { label: 'Manage admins', category: 'access' },
}

const METHOD_VERB: Record<string, string> = {
  GET: 'View',
  POST: 'Create',
  PUT: 'Update',
  PATCH: 'Update',
  DELETE: 'Delete',
}

function isPlaceholder(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}')
}

function deriveEntry(key: string): PermissionEntry {
  const override = LABEL_OVERRIDES[key]
  const sep = key.indexOf(':')
  const method = key.slice(0, sep)
  const relPath = key.slice(sep + 1 + ADMIN_MOUNT.length) || '/'
  const words = relPath
    .split('/')
    .filter((s) => s && !isPlaceholder(s))
    .join(' ')
    .replace(/-/g, ' ')
  const category = relPath.split('/').filter(Boolean)[0] ?? 'general'
  return {
    key,
    label: override?.label ?? `${METHOD_VERB[method] ?? method} ${words}`.trim(),
    category: override?.category ?? category,
  }
}

let cachedCatalog: PermissionEntry[] | null = null

/** The real, route-table-derived permission catalog (cached at module level). */
export function getCatalog(): PermissionEntry[] {
  if (!cachedCatalog) {
    cachedCatalog = getAdminRouteKeys().map(deriveEntry)
  }
  return cachedCatalog
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
