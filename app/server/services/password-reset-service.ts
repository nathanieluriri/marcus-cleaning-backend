import { badRequest } from '@/server/core/errors'
import { generateRefreshToken, hashPassword } from '@/server/security/hash'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as resetRepo from '@/server/repositories/password-reset-repo'
import { sendPasswordResetEmail } from '@/server/core/email/send'

/**
 * Password reset (spec §5.1.1). `requestReset` ALWAYS resolves without revealing
 * whether the email exists (no enumeration). No HTTP types here — the URL builder
 * is injected by the route so this stays reusable/testable.
 */

const TOKEN_TTL_SECONDS = 30 * 60

/** Issue a reset token + email it, if the email maps to a customer. Never throws on unknown email. */
export async function requestReset(email: string, buildResetUrl: (token: string) => string): Promise<void> {
  const customer = await customerRepo.findByEmail(email)
  if (!customer) return // silent — avoids account enumeration
  const token = generateRefreshToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)
  await resetRepo.issue({ customerId: String(customer._id), token, expiresAt })
  await sendPasswordResetEmail({ to: customer.email, resetUrl: buildResetUrl(token) })
}

/** Validate a token and set a new password. 400 on invalid/expired token. */
export async function confirmReset(token: string, newPassword: string): Promise<void> {
  const customerId = await resetRepo.consume(token)
  if (!customerId) throw badRequest('Invalid or expired reset token')
  const hash = await hashPassword(newPassword)
  await customerRepo.updatePassword(customerId, hash)
}
