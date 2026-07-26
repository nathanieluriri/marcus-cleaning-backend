import { randomUUID } from 'node:crypto'
import { AppError } from '@/server/core/errors'
import type { Role } from '@/server/security/principal'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as sessions from './auth-session-service'
import type { DeviceInfo, IssuedTokens } from './auth-session-service'
import { verifyIdentityToken, type VerifiedIdentity } from './identity-token-service'

/**
 * Provision-or-find an account from a verified social identity, and exchange a
 * native SDK's ID token for our own session.
 *
 * Shared by BOTH sign-in paths so they can never drift:
 *   - the browser redirect flow (google-oauth-service)
 *   - the native token exchange (POST /{role}/auth/social)
 *
 * ACCOUNT MATCHING IS SECURITY-CRITICAL. It runs in two steps:
 *
 *   1. Match on (authProvider, authSubject). The subject is minted by the
 *      identity provider and cannot be claimed by anyone else, so this is
 *      always safe.
 *   2. Only if that misses, fall back to matching on email — and ONLY when the
 *      issuer marked the email verified.
 *
 * Step 2's guard is the important one. Firebase will happily mint an ID token
 * for an email/password account whose address was never confirmed, so matching
 * an unverified email against an existing account would let anyone register
 * victim@example.com in our Firebase project and be handed that user's account.
 * Unverified identities are rejected outright in signInWithIdToken.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function splitName(name: string | undefined, email: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { firstName: email.split('@')[0] ?? 'User', lastName: '' }
  const parts = trimmed.split(/\s+/)
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export interface SocialIdentity {
  email: string
  name?: string
  /** Stable provider subject, stored so future logins match on it. */
  subject?: string
  /** `google`, `firebase:apple.com`, … — recorded as the account's login type. */
  provider?: string
  /**
   * Whether the ISSUER vouched for the email. Only a verified email may be used
   * to attach a social login to a pre-existing account — see linkTargetFor.
   */
  emailVerified?: boolean
}

export interface ProvisionResult {
  userId: string
  /** True when this call created the account (useful for onboarding routing). */
  created: boolean
}

/**
 * Find the account a social identity should attach to, or null to create one.
 *
 * `bySubject` is always trusted. `byEmail` is only trusted when the issuer
 * verified the address — otherwise we refuse to link and let the caller decide
 * (it throws upstream rather than silently creating a duplicate on a colliding
 * email, which the unique index would reject anyway).
 */
export function linkTargetFor<T extends { _id: unknown; authProvider?: string | null }>(
  identity: SocialIdentity,
  bySubject: T | null,
  byEmail: T | null,
): { userId: string } | null {
  if (bySubject) return { userId: String(bySubject._id) }
  if (!byEmail) return null

  if (identity.emailVerified !== true) {
    // Never attach an unverified identity to an existing account.
    throw new AppError(
      401,
      'IDENTITY_EMAIL_UNVERIFIED',
      'Verify your email with your sign-in provider before continuing',
      { email: identity.email },
    )
  }
  return { userId: String(byEmail._id) }
}

/** Provision-or-find a customer from a verified social identity. */
export async function provisionCustomer(identity: SocialIdentity): Promise<ProvisionResult> {
  const [bySubject, byEmail] = await Promise.all([
    identity.subject && identity.provider
      ? customerRepo.findByAuthSubject(identity.provider, identity.subject)
      : Promise.resolve(null),
    customerRepo.findByEmail(identity.email),
  ])

  const linked = linkTargetFor(identity, bySubject, byEmail)
  if (linked) return { userId: linked.userId, created: false }

  const { firstName, lastName } = splitName(identity.name, identity.email)
  const ts = nowEpoch()
  const created = await customerRepo.insertCustomer({
    firstName,
    lastName,
    email: identity.email,
    // Social accounts have no local password; store an unusable placeholder so
    // the field is never empty and password login can never succeed.
    password: `${identity.provider ?? 'social'}-oauth:${randomUUID()}`,
    phoneNumber: null,
    avatarDocumentId: null,
    accountStatus: 'ACTIVE',
    loginType: 'google',
    emailVerified: true,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: identity.provider ?? 'google',
    authSubject: identity.subject ?? identity.email,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })
  return { userId: created.id, created: true }
}

/** Provision-or-find a cleaner from a verified social identity. */
export async function provisionCleaner(identity: SocialIdentity): Promise<ProvisionResult> {
  const [bySubject, byEmail] = await Promise.all([
    identity.subject && identity.provider
      ? cleanerRepo.findByAuthSubject(identity.provider, identity.subject)
      : Promise.resolve(null),
    cleanerRepo.findByEmail(identity.email),
  ])

  const linked = linkTargetFor(identity, bySubject, byEmail)
  if (linked) return { userId: linked.userId, created: false }

  const { firstName, lastName } = splitName(identity.name, identity.email)
  const ts = nowEpoch()
  const created = await cleanerRepo.insertCleaner({
    firstName,
    lastName,
    email: identity.email,
    password: `${identity.provider ?? 'social'}-oauth:${randomUUID()}`,
    phoneNumber: null,
    accountStatus: 'ACTIVE',
    loginType: 'google',
    onboardingStatus: 'NOT_STARTED',
    allowAdminSelection: false,
    emailVerified: true,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: identity.provider ?? 'google',
    authSubject: identity.subject ?? identity.email,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })
  return { userId: created.id, created: true }
}

export async function provisionAccount(
  role: Role,
  identity: SocialIdentity,
): Promise<ProvisionResult> {
  if (role === 'cleaner') return provisionCleaner(identity)
  if (role === 'customer') return provisionCustomer(identity)
  throw new AppError(400, 'OAUTH_ROLE_UNSUPPORTED', 'Social sign-in is not available for this role', {
    role,
  })
}

export interface SocialSignInResult extends IssuedTokens {
  userId: string
  email: string
  /** True when the account was created by this sign-in. */
  isNewUser: boolean
  provider: string
}

/**
 * Verify a native SDK's ID token and issue our own session.
 *
 * This is the whole native sign-in contract: the app performs Google/Apple
 * sign-in with the Firebase (or Google) SDK, gets an ID token, and posts it
 * here. Works identically on Android, iOS and web because the verification is
 * of the token, not of any platform-specific flow.
 */
export async function signInWithIdToken(args: {
  role: Role
  idToken: string
  device: DeviceInfo
}): Promise<SocialSignInResult> {
  const identity: VerifiedIdentity = await verifyIdentityToken(args.idToken)

  // An issuer-verified email is a precondition for signing in at all. Firebase
  // mints tokens for unconfirmed email/password accounts, so without this an
  // attacker could register a victim's address and be handed their account.
  if (!identity.emailVerified) {
    throw new AppError(
      401,
      'IDENTITY_EMAIL_UNVERIFIED',
      'Verify your email with your sign-in provider before continuing',
      { email: identity.email, provider: identity.signInProvider ?? identity.issuer },
    )
  }

  const provider =
    identity.issuer === 'firebase'
      ? `firebase:${identity.signInProvider ?? 'unknown'}`
      : 'google'

  const { userId, created } = await provisionAccount(args.role, {
    email: identity.email,
    name: identity.name,
    subject: identity.subject,
    provider,
    emailVerified: identity.emailVerified,
  })

  // Keep the account's last-auth stamp current, same as password login.
  const ts = nowEpoch()
  if (args.role === 'cleaner') await cleanerRepo.updateLastAuthAt(userId, ts)
  else await customerRepo.updateLastAuthAt(userId, ts)

  const issued = await sessions.issueSession({ userId, role: args.role, device: args.device })
  return { ...issued, userId, email: identity.email, isNewUser: created, provider }
}
