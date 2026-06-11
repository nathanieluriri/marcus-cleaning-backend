/**
 * Per-role permission templates: get / put / rollout / preview / rollout-impact.
 * Ported from `role_permission_template_service.py`. No Hono/HTTP types here.
 *
 * `rollout` applies a role's template to existing accounts; `preview` and
 * `rollout-impact` report what *would* change. The exact diff/impact computation
 * awaits the ported logic — see TODOs. See: docs/migration/06-services-and-repositories.md
 */

import { notFound } from '@/server/core/errors'
import * as templateRepo from '@/server/repositories/role-permission-template-repo'

export async function getTemplate(role: string): Promise<Record<string, unknown>> {
  const tpl = await templateRepo.getByRole(role)
  if (!tpl) throw notFound(`No permission template for role '${role}'`)
  return tpl
}

export function putTemplate(role: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return templateRepo.upsertForRole(role, data)
}

export async function rollout(args: {
  role: string
  triggeredBy: string
}): Promise<Record<string, unknown>> {
  // TODO: real implementation — apply the template's permission set to every
  // admin with this role, and write audit events. For now we record the rollout
  // marker and return it so the client flow is preserved.
  const updated = await templateRepo.markRollout(args.role, { triggeredBy: args.triggeredBy, applied: 0 })
  if (!updated) throw notFound(`No permission template for role '${args.role}'`)
  return updated
}

export async function preview(args: {
  role: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const current = await templateRepo.getByRole(args.role)
  // TODO: real implementation — compute the diff between current and proposed
  // permission sets. Returning a well-shaped preview stub for now.
  return {
    role: args.role,
    current: (current?.permissions as unknown) ?? [],
    proposed: (args.payload.permissions as unknown) ?? [],
    added: [],
    removed: [],
  }
}

export async function rolloutImpact(role: string): Promise<Record<string, unknown>> {
  const current = await templateRepo.getByRole(role)
  // TODO: real implementation — count affected admins and per-permission deltas.
  return {
    role,
    affectedAdmins: 0,
    permissionCount: Array.isArray(current?.permissions) ? (current!.permissions as unknown[]).length : 0,
    lastRollout: current?.lastRollout ?? null,
  }
}
