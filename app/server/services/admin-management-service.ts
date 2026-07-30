/**
 * Admin management: signup (admin creates admin), language get/set, and account
 * deletion (self + by id). Ported from the management portion of `admin_service.py`.
 * No Hono/HTTP types here.
 *
 * Auth (login/refresh/profile) lives in the existing `admin-service.ts`; this
 * module covers only the additional core management operations.
 * See: docs/migration/06-services-and-repositories.md
 */

import { AppError, forbidden, notFound, conflict } from '@/server/core/errors'
import { hashPassword } from '@/server/security/hash'
import * as adminRepo from '@/server/repositories/admin-repo'
import * as adminMgmtRepo from '@/server/repositories/admin-management-repo'
import { ADMIN_PRESETS, expandPreset, hasWildcard, listPresetsCatalog, type AccessPresetCatalogItem } from '@/server/security/admin-presets'
import type { AdminCreateSignup } from '@/server/schemas/admin-core'
import type { AdminDoc, AdminOut } from '@/server/schemas/admin'

const nowEpoch = () => Math.floor(Date.now() / 1000)

export async function signup(payload: AdminCreateSignup): Promise<AdminOut> {
  const existing = await adminRepo.findByEmail(payload.email.toLowerCase())
  if (existing) throw new AppError(409, 'EMAIL_EXISTS', 'An admin with this email already exists')
  const ts = nowEpoch()
  return adminRepo.insertAdmin({
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email.toLowerCase(),
    password: await hashPassword(payload.password),
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: payload.permissionList ?? [],
    preferredLanguage: 'en',
    authProvider: 'local',
    dateCreated: ts,
    lastUpdated: ts,
  })
}

export interface AdminListResult {
  items: AdminOut[]
  total: number
}

/** Paginated admin listing (Team page). Every item goes through `toAdminOut` — never leaks password/totpSecret/backupCodes. */
export async function listAdmins(args: { limit?: number; skip?: number }): Promise<AdminListResult> {
  const { items, total } = await adminRepo.listAdmins(args)
  return { items: items.map((doc) => adminRepo.toAdminOut(doc)), total }
}

export async function getLanguage(adminId: string): Promise<'en' | 'fr'> {
  const lang = await adminMgmtRepo.getLanguage(adminId)
  if (lang === null) throw notFound('Admin not found')
  return lang
}

export async function setLanguage(adminId: string, language: 'en' | 'fr'): Promise<'en' | 'fr'> {
  const raw = await adminRepo.findById(adminId)
  if (!raw) throw notFound('Admin not found')
  await adminMgmtRepo.updateLanguage(adminId, language)
  return language
}

export async function deleteAccount(adminId: string): Promise<{ deleted: boolean }> {
  const deleted = await adminMgmtRepo.deleteById(adminId)
  if (!deleted) throw notFound('Admin not found')
  return { deleted }
}

export async function deleteAdmin(targetId: string): Promise<{ deleted: boolean }> {
  const deleted = await adminMgmtRepo.deleteById(targetId)
  if (!deleted) throw notFound('Admin not found')
  return { deleted }
}

// ============================ access presets ============================

/** True when a (partial) admin doc's effective permissions include the wildcard. */
function isStarHolder(doc: Pick<AdminDoc, 'isSuperAdmin' | 'permissionList'>): boolean {
  return doc.isSuperAdmin === true || hasWildcard(doc.permissionList ?? [])
}

export function listAccessPresets(): AccessPresetCatalogItem[] {
  return listPresetsCatalog()
}

/**
 * Change one admin's access preset. Rules (Task 6 brief):
 *  - preset must be a known key.
 *  - target admin must exist.
 *  - only a super admin may change *another* admin's preset, or any preset
 *    that touches a super-admin-equivalent (current star holder, or the new
 *    preset is `all_controls`).
 *  - cannot change the preset of the *last* admin whose effective
 *    permissions include `'*'` (the "last-star" protection).
 */
export async function setAccessPreset(args: {
  callerId: string
  targetId: string
  preset: string
}): Promise<AdminOut> {
  const { callerId, targetId, preset } = args
  if (!ADMIN_PRESETS[preset]) throw notFound(`Unknown access preset '${preset}'`)

  const target = await adminRepo.findById(targetId)
  if (!target) throw notFound('Admin not found')

  const caller = await adminRepo.findById(callerId)
  const callerIsSuper = caller ? isStarHolder(caller) : false

  const targetIsStar = isStarHolder(target)
  const requiresSuperCaller = targetId !== callerId || targetIsStar || preset === 'all_controls'
  if (requiresSuperCaller && !callerIsSuper) {
    throw forbidden('Only a super admin can change this access preset')
  }

  if (targetIsStar && preset !== 'all_controls') {
    const starCount = await adminRepo.countAdminsWithStar()
    if (starCount <= 1) {
      throw conflict('Cannot change the preset of the last admin with full access', { adminId: targetId })
    }
  }

  const permissionList = expandPreset(preset)
  await adminRepo.updateAdmin(targetId, { accessPreset: preset, permissionList })
  const refreshed = await adminRepo.findById(targetId)
  return adminRepo.toAdminOut(refreshed)
}

export interface BulkAccessPresetResult {
  updated: number
  skipped: { id: string; reason: string }[]
}

export async function bulkSetAccessPreset(args: {
  callerId: string
  adminIds: string[]
  preset: string
}): Promise<BulkAccessPresetResult> {
  const { callerId, adminIds, preset } = args
  const skipped: { id: string; reason: string }[] = []
  let updated = 0
  for (const id of adminIds) {
    try {
      await setAccessPreset({ callerId, targetId: id, preset })
      updated += 1
    } catch (err) {
      const reason = err instanceof AppError ? err.message : 'Failed to update access preset'
      skipped.push({ id, reason })
    }
  }
  return { updated, skipped }
}
