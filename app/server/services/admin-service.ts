import { AppError, notFound } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import { hashPassword, verifyPassword } from '@/server/security/hash'
import * as adminRepo from '@/server/repositories/admin-repo'
import * as sessions from './auth-session-service'
import type { DeviceInfo } from './auth-session-service'
import type { AdminLogin, AdminOut } from '@/server/schemas/admin'

/**
 * Admin auth/profile business logic. Ported from `admin_service.py` +
 * `super_admin_identity_service.py`. Admin identity is now self-issued JWT
 * (Auth0 dropped). See: docs/migration/03-auth.md
 */

export interface AdminAuthResult {
  admin: AdminOut
  accessToken: string
  refreshToken: string
  expiresIn: number
  language: 'en' | 'fr'
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
const nowEpoch = () => Math.floor(Date.now() / 1000)

/**
 * Ensure a super-admin account exists if SUPER_ADMIN_EMAIL/PASSWORD are set, then
 * return it. Bootstraps on first login (parity with the old static super-admin).
 */
async function bootstrapSuperAdmin(email: string): Promise<void> {
  const s = getSettings()
  if (!s.SUPER_ADMIN_EMAIL || !s.SUPER_ADMIN_PASSWORD) return
  if (email.toLowerCase() !== s.SUPER_ADMIN_EMAIL.toLowerCase()) return
  if (await adminRepo.findByEmail(email)) return
  const ts = nowEpoch()
  await adminRepo.insertAdmin({
    firstName: 'Super',
    lastName: 'Admin',
    email: email.toLowerCase(),
    password: await hashPassword(s.SUPER_ADMIN_PASSWORD),
    accountStatus: 'ACTIVE',
    isSuperAdmin: true,
    permissionList: ['*'],
    preferredLanguage: 'en',
    authProvider: 'local',
    dateCreated: ts,
    lastUpdated: ts,
  })
}

export async function login(payload: AdminLogin, device: DeviceInfo): Promise<AdminAuthResult> {
  await bootstrapSuperAdmin(payload.email)
  const raw = await adminRepo.findByEmail(payload.email.toLowerCase())
  if (!raw) throw invalidCredentials()
  if (!(await verifyPassword(payload.password, raw.password))) throw invalidCredentials()
  const admin = adminRepo.toAdminOut(raw)
  await adminRepo.updateLastAuthAt(admin.id, nowEpoch())
  const issued = await sessions.issueSession({ userId: admin.id, role: 'admin', device })
  return { admin, ...issued, language: admin.preferredLanguage }
}

export async function refresh(presentedToken: string, device: DeviceInfo): Promise<Omit<AdminAuthResult, 'admin'>> {
  const rotated = await sessions.rotateRefresh({ presentedToken, device, expectedRole: 'admin' })
  const raw = await adminRepo.findById(rotated.userId)
  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresIn: rotated.expiresIn,
    language: (raw?.preferredLanguage as 'en' | 'fr') ?? 'en',
  }
}

export async function getProfile(adminId: string): Promise<AdminOut> {
  const raw = await adminRepo.findById(adminId)
  if (!raw) throw notFound('Admin not found')
  return adminRepo.toAdminOut(raw)
}
