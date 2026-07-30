/**
 * Per-role permission templates: get / put / rollout / preview / rollout-impact.
 * Ported from `role_permission_template_service.py`. No Hono/HTTP types here.
 *
 * As of Task 6, template "roles" are access-preset keys (see
 * `security/admin-presets.ts`). `getTemplate` merges the preset's built-in
 * definition with any stored override (`PUT` writes an override document).
 * `rollout` applies the effective template's permission list to every admin
 * whose stored `accessPreset` equals the role; `preview` diffs the current
 * effective permissions against a proposed set; `rolloutImpact` counts how
 * many admins a rollout would touch.
 *
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md (Task 6)
 */

import { notFound } from '@/server/core/errors'
import { ADMIN_PRESETS, expandPreset } from '@/server/security/admin-presets'
import * as templateRepo from '@/server/repositories/role-permission-template-repo'
import * as adminRepo from '@/server/repositories/admin-repo'

function isKnownRole(role: string): boolean {
  return Boolean(ADMIN_PRESETS[role])
}

/** Effective permission list for a role: stored override wins, else the preset's default. */
async function effectivePermissions(role: string): Promise<string[]> {
  const stored = await templateRepo.getByRole(role)
  const storedPermissions = stored?.permissions
  if (Array.isArray(storedPermissions)) return storedPermissions as string[]
  return expandPreset(role)
}

export async function getTemplate(role: string): Promise<Record<string, unknown>> {
  const preset = ADMIN_PRESETS[role]
  if (!preset) throw notFound(`No permission template for role '${role}'`)
  const stored = await templateRepo.getByRole(role)
  const permissions = Array.isArray(stored?.permissions) ? (stored!.permissions as string[]) : [...preset.permissions]
  return {
    role,
    label: preset.label,
    description: preset.description,
    permissions,
    lastRollout: stored?.lastRollout ?? null,
    lastUpdated: stored?.lastUpdated ?? null,
  }
}

export function putTemplate(role: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isKnownRole(role)) throw notFound(`No permission template for role '${role}'`)
  return templateRepo.upsertForRole(role, data)
}

export async function rollout(args: {
  role: string
  triggeredBy: string
}): Promise<Record<string, unknown>> {
  const { role, triggeredBy } = args
  if (!isKnownRole(role)) throw notFound(`No permission template for role '${role}'`)

  const permissions = await effectivePermissions(role)
  const affected = await adminRepo.listByAccessPreset(role)
  await Promise.all(
    affected.map((admin) => adminRepo.updateAdmin(String(admin._id), { accessPreset: role, permissionList: [...permissions] })),
  )

  const updated = await templateRepo.markRollout(role, { triggeredBy, applied: affected.length })
  return updated ?? { role, lastRollout: { triggeredBy, applied: affected.length } }
}

export async function preview(args: {
  role: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { role, payload } = args
  if (!isKnownRole(role)) throw notFound(`No permission template for role '${role}'`)

  const current = await effectivePermissions(role)
  const proposedRaw = payload.permissions
  const proposed = Array.isArray(proposedRaw) ? (proposedRaw as string[]) : current

  const currentSet = new Set(current)
  const proposedSet = new Set(proposed)
  const added = proposed.filter((p) => !currentSet.has(p))
  const removed = current.filter((p) => !proposedSet.has(p))

  return { role, current, proposed, added, removed }
}

export async function rolloutImpact(role: string): Promise<Record<string, unknown>> {
  if (!isKnownRole(role)) throw notFound(`No permission template for role '${role}'`)

  const [current, affectedAdmins] = await Promise.all([
    templateRepo.getByRole(role),
    adminRepo.countByAccessPreset(role),
  ])
  const permissions = await effectivePermissions(role)
  return {
    role,
    affectedAdmins,
    permissionCount: permissions.length,
    lastRollout: current?.lastRollout ?? null,
  }
}
