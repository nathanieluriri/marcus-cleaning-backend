import { randomInt } from 'node:crypto'
import { AppError } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import { sha256, timingSafeStringEqual } from '@/server/security/hash'
import * as otpRepo from '@/server/repositories/admin-otp-repo'
import * as adminRepo from '@/server/repositories/admin-repo'
import * as adminTotpService from '@/server/services/admin-totp-service'
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
/** Max wrong-code attempts a challenge accepts before it locks (see `incrementAttemptsIfUnderLimit`). */
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
const otpEmailFailed = () =>
  new AppError(
    502,
    'OTP_EMAIL_FAILED',
    'Could not send your login code. Email is not configured or the sender domain is not verified.',
  )

/** Live TOTP-or-backup-code verification, delegated to `admin-totp-service` (Task 3). */
export async function verifyTotpOrBackupCode(admin: AdminDoc & { id: string }, code: string): Promise<boolean> {
  return adminTotpService.verifyTotpOrBackupCode(admin, code)
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
    try {
      await sendOtpEmail({ to: admin.email, otp: code })
    } catch (err) {
      // Without this the admin sees a bare 500 after a CORRECT password and has
      // no idea why. The underlying cause is a deployment problem (no
      // RESEND_API_KEY, unverified sender domain), so log it for the platform
      // logs and return a stable, non-leaking code to the client — the provider
      // message can carry account/config detail and must not reach the browser.
      console.error('[admin-otp] failed to send login OTP email', err)
      throw otpEmailFailed()
    }
  }

  const challengeId = otpRepo.generateChallengeId()
  await otpRepo.insertChallenge({
    challengeId,
    adminId: admin.id,
    codeHash,
    method,
    attempts: 0,
    expiresAt: ts + CHALLENGE_TTL_SECONDS,
    consumedAt: null,
    dateCreated: ts,
  })

  return { challengeId, method }
}

/** Verify a challenge code and, on success, issue a session like `login` does. */
export async function verifyChallenge(args: {
  challengeId: string
  code: string
  device: DeviceInfo
}): Promise<AdminOtpVerifyResult> {
  const challenge = await otpRepo.findByChallengeId(args.challengeId)
  if (!challenge) throw otpInvalid()
  if (challenge.consumedAt) throw otpInvalid()

  const ts = nowEpoch()
  if (challenge.expiresAt < ts) throw otpExpired()

  // Atomic check-and-increment: a stale-read gate (read attempts, compare,
  // then $inc separately) lets concurrent guesses all pass the check before
  // any of them lands the increment. This does both in one round trip.
  const incremented = await otpRepo.incrementAttemptsIfUnderLimit(args.challengeId, MAX_ATTEMPTS)
  if (!incremented) throw otpLocked()

  const raw = await adminRepo.findById(incremented.adminId)
  if (!raw) throw otpInvalid()

  const s = getSettings()
  const devCodeAccepted =
    s.NODE_ENV !== 'production' && !!s.OTP_DEV_CODE && timingSafeStringEqual(s.OTP_DEV_CODE, args.code)

  let accepted = devCodeAccepted
  if (!accepted) {
    if (incremented.method === 'totp') {
      accepted = await verifyTotpOrBackupCode({ ...raw, id: String(raw._id) }, args.code)
    } else {
      accepted = !!incremented.codeHash && timingSafeStringEqual(sha256(args.code), incremented.codeHash)
    }
  }

  if (!accepted) throw otpInvalid()

  // Successful verify consumes the challenge regardless of how many attempts
  // it took — no need to "give back" the attempt this call used.
  await otpRepo.markConsumed(args.challengeId, ts)

  const admin = adminRepo.toAdminOut(raw)
  await adminRepo.updateLastAuthAt(admin.id, ts)
  const issued = await sessions.issueSession({ userId: admin.id, role: 'admin', device: args.device })
  return { admin, ...issued, language: admin.preferredLanguage }
}
