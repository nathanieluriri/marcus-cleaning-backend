/**
 * Admin management: signup (admin creates admin), language get/set, and account
 * deletion (self + by id). Ported from the management portion of `admin_service.py`.
 * No Hono/HTTP types here.
 *
 * Auth (login/refresh/profile) lives in the existing `admin-service.ts`; this
 * module covers only the additional core management operations.
 * See: docs/migration/06-services-and-repositories.md
 */

import { AppError, notFound } from '@/server/core/errors'
import { hashPassword } from '@/server/security/hash'
import * as adminRepo from '@/server/repositories/admin-repo'
import * as adminMgmtRepo from '@/server/repositories/admin-management-repo'
import type { AdminCreateSignup } from '@/server/schemas/admin-core'
import type { AdminOut } from '@/server/schemas/admin'

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
