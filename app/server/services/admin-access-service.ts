/**
 * Admin access-control workflow: elevation requests + decisions.
 * Ported from the access-request portion of `admin_service.py`.
 * No Hono/HTTP types here. See: docs/migration/06-services-and-repositories.md
 */

import { notFound } from '@/server/core/errors'
import * as accessRepo from '@/server/repositories/admin-access-repo'

export function requestElevation(args: {
  adminId: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  return accessRepo.createRequest({ adminId: args.adminId, ...args.payload })
}

export async function elevationStatus(adminId: string): Promise<Record<string, unknown>> {
  const latest = await accessRepo.latestRequestForAdmin(adminId)
  return latest ?? { status: 'NONE', adminId }
}

export function listRequests(args: { limit?: number; skip?: number }): Promise<{
  items: Array<Record<string, unknown>>
  total: number
}> {
  return accessRepo.listRequests(args)
}

export async function decideRequest(args: {
  requestId: string
  decision: string
  deciderId: string
  notes?: string
}): Promise<Record<string, unknown>> {
  const updated = await accessRepo.decideRequest(args.requestId, args.decision, args.deciderId, args.notes)
  if (!updated) throw notFound('Access request not found')
  return updated
}
