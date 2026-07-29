import { randomBytes } from 'node:crypto'
import { AppError } from '@/server/core/errors'
import { sha256 } from '@/server/security/hash'
import { base32Encode, generateSecret, otpauthUri, verifyTotp } from '@/server/security/totp'
import * as adminRepo from '@/server/repositories/admin-repo'
import type { AdminDoc } from '@/server/schemas/admin'

/**
 * TOTP enrollment + backup codes for an already-authenticated admin (Task 3,
 * admin platform plan). Login-time verification against an enrolled admin
 * lives in `verifyTotpOrBackupCode`, consumed by `admin-otp-service`'s
 * `verifyChallenge` for `method: 'totp'` challenges.
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 */

const BACKUP_CODE_COUNT = 8
const BACKUP_CODE_LENGTH = 10

const totpNotPending = () => new AppError(400, 'TOTP_NOT_PENDING', 'No pending TOTP setup — call /2fa/setup first')
const totpInvalid = () => new AppError(401, 'TOTP_INVALID', 'Invalid TOTP or backup code')
const totpNotEnabled = () => new AppError(400, 'TOTP_NOT_ENABLED', 'TOTP is not enabled for this admin')
const adminNotFound = () => new AppError(404, 'ADMIN_NOT_FOUND', 'Admin not found')

async function loadAdmin(adminId: string) {
  const admin = await adminRepo.findById(adminId)
  if (!admin) throw adminNotFound()
  return admin
}

/** One 10-char base32 backup code, drawn from the same alphabet/entropy source as TOTP secrets. */
function generateBackupCode(): string {
  return base32Encode(randomBytes(BACKUP_CODE_LENGTH)).slice(0, BACKUP_CODE_LENGTH)
}

function generateBackupCodes(count: number): string[] {
  return Array.from({ length: count }, generateBackupCode)
}

export interface TotpSetupResult {
  secret: string
  otpauthUri: string
}

/**
 * Begin (or restart) TOTP enrollment: stores a fresh pending secret, returns
 * it + a QR-ready URI.
 *
 * Fresh enrollment (no TOTP ever enabled) needs no proof. RE-enrollment —
 * `totpEnabledAt` already set — requires `code` to match the CURRENT live
 * secret or an unused backup code; otherwise an attacker who steals a live
 * session could silently swap in their own secret and lock the real admin
 * out of 2FA without ever proving they control the existing factor.
 */
export async function setup(adminId: string, code?: string): Promise<TotpSetupResult> {
  const admin = await loadAdmin(adminId)
  if (admin.totpEnabledAt != null) {
    if (!code || !(await verifyTotpOrBackupCode({ ...admin, id: String(admin._id) }, code))) {
      throw totpInvalid()
    }
  }
  const secret = generateSecret()
  await adminRepo.updateAdmin(adminId, { totpPendingSecret: secret })
  return { secret, otpauthUri: otpauthUri({ secret, accountName: admin.email }) }
}

export interface TotpVerifyResult {
  backupCodes: string[]
}

/**
 * Confirm enrollment: checks `code` against the pending secret. On success,
 * promotes it to the live secret, stamps `totpEnabledAt`, and mints a fresh
 * set of backup codes (plaintext returned once, only sha256 hashes stored).
 * A wrong code leaves the pending secret untouched — the admin can retry.
 */
export async function verify(adminId: string, code: string): Promise<TotpVerifyResult> {
  const admin = await loadAdmin(adminId)
  const pending = admin.totpPendingSecret
  if (!pending) throw totpNotPending()
  if (!verifyTotp(pending, code)) throw totpInvalid()

  const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT)
  const now = Math.floor(Date.now() / 1000)
  await adminRepo.updateAdmin(adminId, {
    totpSecret: pending,
    totpPendingSecret: null,
    totpEnabledAt: now,
    backupCodes: backupCodes.map(sha256),
  })
  return { backupCodes }
}

/**
 * Verify a login-time code against an enrolled admin's live TOTP secret,
 * falling back to a single-use backup code. Used by `admin-otp-service`'s
 * `verifyChallenge` for `method: 'totp'` challenges — never touches the
 * pending-enrollment secret.
 */
export async function verifyTotpOrBackupCode(admin: AdminDoc & { id: string }, code: string): Promise<boolean> {
  if (admin.totpSecret && verifyTotp(admin.totpSecret, code)) return true

  const hash = sha256(code.trim())
  if (!admin.backupCodes?.includes(hash)) return false
  // Atomic $pull — see admin-repo.consumeBackupCode for the race it closes.
  return adminRepo.consumeBackupCode(admin.id, hash)
}

/** Require the admin to prove control of the authenticator (TOTP) or a backup code before a sensitive change. */
async function assertEnrolledAndVerified(adminId: string, code: string) {
  const admin = await loadAdmin(adminId)
  if (admin.totpEnabledAt == null) throw totpNotEnabled()
  const ok = await verifyTotpOrBackupCode({ ...admin, id: String(admin._id) }, code)
  if (!ok) throw totpInvalid()
  return admin
}

/** Disable TOTP entirely: clears the live/pending secrets and all backup codes. */
export async function disable(adminId: string, code: string): Promise<void> {
  await assertEnrolledAndVerified(adminId, code)
  await adminRepo.updateAdmin(adminId, {
    totpSecret: null,
    totpPendingSecret: null,
    totpEnabledAt: null,
    backupCodes: [],
  })
}

export interface RegenerateBackupCodesResult {
  backupCodes: string[]
}

/** Invalidate all existing backup codes and mint a fresh set (plaintext returned once). */
export async function regenerateBackupCodes(adminId: string, code: string): Promise<RegenerateBackupCodesResult> {
  await assertEnrolledAndVerified(adminId, code)
  const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT)
  await adminRepo.updateAdmin(adminId, { backupCodes: backupCodes.map(sha256) })
  return { backupCodes }
}
