import { randomInt } from 'node:crypto'
import { AppError } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import { sha256 } from '@/server/security/hash'
import * as otpRepo from '@/server/repositories/admin-otp-repo'
import * as adminRepo from '@/server/repositories/admin-repo'
import { sendOtpEmail } from '@/server/core/email/send'
import * as sessions from './auth-session-service'
import type { DeviceInfo } from './auth-session-service'
import type { AdminDoc, AdminOut } from '@/server/schemas/admin'

/**
 * Admin login 2FA — email OTP today, TOTP once a device is enrolled (Task 3
 * replaces `verifyTotpOrBackupCode`, currently a stub). Ported concept from
 * `admin_service.py`'s login flow; new for the TS admin platform.
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 */

const CHALLENGE_TTL_SECONDS = 600
const MAX_ATTEMPTS = 5
const nowEpoch = () => Math.floor(Date.now() / 1000)

export interface AdminChallengeResult {
  challengeId: string
  method: 'email' | 'totp'
}

export interface AdminOtpVerifyResult {
  admin: AdminOut
  accessToken: string
  refreshToken: string
  expiresIn: number
  language: 'en' | 'fr'
}

const otpInvalid = () => new AppError(401, 'OTP_INVALID', 'Invalid or expired code')
const otpExpired = () => new AppError(401, 'OTP_EXPIRED', 'Code has expired')
const otpLocked = () =>
  new AppError(429, 'OTP_LOCKED', 'Too many failed attempts', { retry_after_seconds: CHALLENGE_TTL_SECONDS })

/**
 * Seam for Task 3: real TOTP + backup-code verification lands here once
 * `security/totp.ts` + `admin-totp-service.ts` exist. Always rejects for now.
 */
export async function verifyTotpOrBackupCode(_admin: AdminDoc & { id: string }, _code: string): Promise<boolean> {
  return false
}

function generateSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Create a login challenge for an already-password-verified admin. */
export async function createChallenge(admin: {
  id: string
  email: string
  totpEnabledAt?: number | null
}): Promise<AdminChallengeResult> {
  const method: 'email' | 'totp' = admin.totpEnabledAt != null ? 'totp' : 'email'
  const ts = nowEpoch()
  let codeHash: string | null = null

  if (method === 'email') {
    const code = generateSixDigitCode()
    codeHash = sha256(code)
    await sendOtpEmail({ to: admin.email, otp: code })
  }

  const stored = await otpRepo.insertChallenge({
    adminId: admin.id,
    codeHash,
    method,
    attempts: 0,
    expiresAt: ts + CHALLENGE_TTL_SECONDS,
    consumedAt: null,
    dateCreated: ts,
  })

  return { challengeId: String(stored._id), method }
}

/** Verify a challenge code and, on success, issue a session like `login` does. */
export async function verifyChallenge(args: {
  challengeId: string
  code: string
  device: DeviceInfo
}): Promise<AdminOtpVerifyResult> {
  const challenge = await otpRepo.findById(args.challengeId)
  if (!challenge) throw otpInvalid()
  if (challenge.consumedAt) throw otpInvalid()

  const ts = nowEpoch()
  if (challenge.expiresAt < ts) throw otpExpired()
  if (challenge.attempts >= MAX_ATTEMPTS) throw otpLocked()

  const raw = await adminRepo.findById(challenge.adminId)
  if (!raw) throw otpInvalid()

  const s = getSettings()
  const devCodeAccepted = s.NODE_ENV !== 'production' && !!s.OTP_DEV_CODE && s.OTP_DEV_CODE === args.code

  let accepted = devCodeAccepted
  if (!accepted) {
    if (challenge.method === 'totp') {
      accepted = await verifyTotpOrBackupCode({ ...raw, id: String(raw._id) }, args.code)
    } else {
      accepted = !!challenge.codeHash && sha256(args.code) === challenge.codeHash
    }
  }

  if (!accepted) {
    const attempts = await otpRepo.incrementAttempts(args.challengeId)
    if (attempts >= MAX_ATTEMPTS) throw otpLocked()
    throw otpInvalid()
  }

  await otpRepo.markConsumed(args.challengeId, ts)

  const admin = adminRepo.toAdminOut(raw)
  await adminRepo.updateLastAuthAt(admin.id, ts)
  const issued = await sessions.issueSession({ userId: admin.id, role: 'admin', device: args.device })
  return { admin, ...issued, language: admin.preferredLanguage }
}
