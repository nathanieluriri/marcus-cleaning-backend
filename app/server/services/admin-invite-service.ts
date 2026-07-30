/**
 * Invite-only admin creation (Task 5). An invited admin is created with a
 * random temporary password, `mustChangePassword: true`, and a 72h expiry;
 * they receive the temp password by email and must change it on first login
 * (enforced elsewhere — Task 4/2). No Hono/HTTP types here.
 *
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md (Task 5)
 */

import { randomBytes } from 'node:crypto'
import { AppError, notFound } from '@/server/core/errors'
import { hashPassword } from '@/server/security/hash'
import { expandPreset } from '@/server/security/admin-presets'
import { sendAdminInviteEmail } from '@/server/core/email/send'
import { getSettings } from '@/server/core/settings'
import * as adminRepo from '@/server/repositories/admin-repo'
import type { AdminOut } from '@/server/schemas/admin'

const TEMP_PASSWORD_TTL_SECONDS = 72 * 60 * 60
const nowEpoch = () => Math.floor(Date.now() / 1000)

/** 12-char base64url random temp password (9 random bytes → exactly 12 base64url chars, no padding). */
function generateTempPassword(): string {
  return randomBytes(9).toString('base64url')
}

function resolveLoginUrl(): string {
  const settings = getSettings()
  if (settings.ADMIN_LOGIN_URL) return settings.ADMIN_LOGIN_URL
  const origins = (settings.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (origins[0]) return `${origins[0]}/login`
  return 'http://localhost:3000/login'
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim()
  const idx = trimmed.indexOf(' ')
  if (idx === -1) return { firstName: trimmed, lastName: trimmed }
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() || trimmed.slice(0, idx) }
}

export interface InviteArgs {
  email: string
  fullName: string
  accessPreset: string
  invitedBy?: string | null
}

export async function invite(args: InviteArgs): Promise<AdminOut> {
  const email = args.email.toLowerCase()
  const existing = await adminRepo.findByEmail(email)
  if (existing) throw new AppError(409, 'EMAIL_EXISTS', 'An admin with this email already exists')

  const { firstName, lastName } = splitName(args.fullName)
  const tempPassword = generateTempPassword()
  const ts = nowEpoch()

  const created = await adminRepo.insertAdmin({
    firstName,
    lastName,
    email,
    password: await hashPassword(tempPassword),
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: expandPreset(args.accessPreset),
    preferredLanguage: 'en',
    authProvider: 'local',
    accessPreset: args.accessPreset,
    mustChangePassword: true,
    tempPasswordExpiresAt: ts + TEMP_PASSWORD_TTL_SECONDS,
    dateCreated: ts,
    lastUpdated: ts,
  })

  await sendAdminInviteEmail({
    to: email,
    tempPassword,
    loginUrl: resolveLoginUrl(),
    invitedByName: args.invitedBy ?? null,
  })

  return created
}

export async function resend(adminId: string): Promise<AdminOut> {
  const admin = await adminRepo.findById(adminId)
  if (!admin) throw notFound('Admin not found')
  if (!admin.mustChangePassword) {
    throw new AppError(409, 'ALREADY_ACTIVATED', 'This admin has already activated their account')
  }

  const tempPassword = generateTempPassword()
  const ts = nowEpoch()
  const patch = {
    password: await hashPassword(tempPassword),
    mustChangePassword: true,
    tempPasswordExpiresAt: ts + TEMP_PASSWORD_TTL_SECONDS,
  }
  await adminRepo.updateAdmin(String(admin._id), patch)

  await sendAdminInviteEmail({
    to: admin.email,
    tempPassword,
    loginUrl: resolveLoginUrl(),
  })

  const refreshed = await adminRepo.findById(adminId)
  return adminRepo.toAdminOut(refreshed)
}
