import type { ReactElement } from 'react'
import { getResend } from './resend'
import { getSettings } from '@/server/core/settings'
import { AppError } from '@/server/core/errors'
import { OtpEmail } from '@/server/emails/otp'
import { NewSignInEmail } from '@/server/emails/new-sign-in'
import { InvitationEmail } from '@/server/emails/invitation'
import { RevokeEmail } from '@/server/emails/revoke'
import { PasswordResetEmail } from '@/server/emails/password-reset'

/**
 * Typed transactional email helpers (Resend + React Email).
 *
 * The Resend Node SDK NEVER throws on API errors — it returns `{ data, error }`.
 * Each helper checks `error` and raises an AppError on failure.
 *
 * React components are passed as a function call (`OtpEmail({...})`), NOT JSX,
 * in the `react` field. The idempotency key is the SECOND argument (24h dedupe).
 *
 * See: docs/migration/08-email-resend.md
 */

const emailSendError = (detail: unknown) =>
  new AppError(502, 'EMAIL_SEND_FAILED', 'Failed to send email', detail)

async function dispatch(args: {
  to: string | string[]
  subject: string
  react: ReactElement
  idempotencyKey: string
}) {
  const to = Array.isArray(args.to) ? args.to : [args.to]
  const { data, error } = await getResend().emails.send(
    {
      from: getSettings().EMAIL_FROM,
      to,
      subject: args.subject,
      react: args.react,
    },
    { idempotencyKey: args.idempotencyKey },
  )
  if (error) throw emailSendError(error)
  return data
}

export async function sendOtpEmail(args: { to: string; otp: string }) {
  return dispatch({
    to: args.to,
    subject: 'Your Marcus Cleaning login code',
    react: OtpEmail({ otp: args.otp, userEmail: args.to }),
    idempotencyKey: `otp/${args.to}/${args.otp}`,
  })
}

export async function sendNewSignInEmail(args: {
  to: string
  deviceInfo?: string | null
  ip?: string | null
  signedInAt?: string | null
}) {
  return dispatch({
    to: args.to,
    subject: 'New sign-in to your Marcus Cleaning account',
    react: NewSignInEmail({
      userEmail: args.to,
      deviceInfo: args.deviceInfo ?? null,
      ip: args.ip ?? null,
      signedInAt: args.signedInAt ?? null,
    }),
    idempotencyKey: `new-sign-in/${args.to}/${args.signedInAt ?? Date.now()}`,
  })
}

export async function sendInvitationEmail(args: {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}) {
  return dispatch({
    to: args.to,
    subject: 'You have been invited to Marcus Cleaning',
    react: InvitationEmail({
      inviteeEmail: args.to,
      inviteUrl: args.inviteUrl,
      invitedByName: args.invitedByName ?? null,
    }),
    idempotencyKey: `invitation/${args.to}/${args.inviteUrl}`,
  })
}

export async function sendRevokeEmail(args: { to: string; reason?: string | null }) {
  return dispatch({
    to: args.to,
    subject: 'Your Marcus Cleaning access has been revoked',
    react: RevokeEmail({ userEmail: args.to, reason: args.reason ?? null }),
    idempotencyKey: `revoke/${args.to}/${args.reason ?? 'na'}`,
  })
}

export async function sendPasswordResetEmail(args: { to: string; resetUrl: string }) {
  return dispatch({
    to: args.to,
    subject: 'Reset your Marcus Cleaning password',
    react: PasswordResetEmail({ userEmail: args.to, resetUrl: args.resetUrl }),
    idempotencyKey: `password-reset/${args.to}/${args.resetUrl}`,
  })
}
