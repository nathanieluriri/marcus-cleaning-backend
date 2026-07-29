import { badRequest } from '@/server/core/errors'
import { generateRefreshToken, hashPassword } from '@/server/security/hash'
import type { Role } from '@/server/security/principal'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as resetRepo from '@/server/repositories/password-reset-repo'
import * as sessions from '@/server/services/auth-session-service'
import { sendPasswordResetEmail } from '@/server/core/email/send'

/**
 * Password reset (spec §5.1.1). `requestReset` ALWAYS resolves without revealing
 * whether the email exists (no enumeration). No HTTP types here — the URL builder
 * is injected by the route so this stays reusable/testable.
 *
 * Generalised by role (customer/cleaner) the same way social-account-service
 * provisions accounts per role — one account-repo lookup, selected by `role`.
 * The role is stamped on the reset-token document at issue and checked again
 * at confirm, so a token minted for one role can never reset an account of
 * another role.
 */

const TOKEN_TTL_SECONDS = 30 * 60

interface AccountRepo {
  findByEmail(email: string): Promise<{ _id: unknown; email: string } | null>
  updatePassword(id: string, passwordHash: string): Promise<void>
}

function repoFor(role: Role): AccountRepo {
  if (role === 'cleaner') return cleanerRepo as unknown as AccountRepo
  if (role === 'customer') return customerRepo as unknown as AccountRepo
  throw badRequest('Password reset is not available for this role')
}

/** Issue a reset token + email it, if the email maps to an account of the given role. Never throws on unknown email. */
export async function requestReset(
  role: Role,
  email: string,
  buildResetUrl: (token: string) => string,
): Promise<void> {
  const repo = repoFor(role)
  const account = await repo.findByEmail(email)
  if (!account) return // silent — avoids account enumeration
  const token = generateRefreshToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)
  await resetRepo.issue({ accountId: String(account._id), role, token, expiresAt })
  await sendPasswordResetEmail({ to: account.email, resetUrl: buildResetUrl(token) })
}

/**
 * Validate a token (scoped to the given role) and set a new password. 400 on
 * invalid/expired token, or a token issued for a different role.
 * Revokes all existing sessions so any tokens an attacker already holds are
 * invalidated — password reset is the account-recovery path.
 */
export async function confirmReset(role: Role, token: string, newPassword: string): Promise<void> {
  const repo = repoFor(role)
  const accountId = await resetRepo.consume(token, role)
  if (!accountId) throw badRequest('Invalid or expired reset token')
  const hash = await hashPassword(newPassword)
  await repo.updatePassword(accountId, hash)
  await sessions.revokeAllSessions(accountId)
}
