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
 * Accounts are matched on email. A user who signed up with a password and later
 * taps "Continue with Google" lands on their existing account rather than a
 * duplicate — the alternative silently strands their booking history.
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
}

export interface ProvisionResult {
  userId: string
  /** True when this call created the account (useful for onboarding routing). */
  created: boolean
}

/** Provision-or-find a customer from a verified social identity. */
export async function provisionCustomer(identity: SocialIdentity): Promise<ProvisionResult> {
  const existing = await customerRepo.findByEmail(identity.email)
  if (existing) return { userId: String(existing._id), created: false }

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
  const existing = await cleanerRepo.findByEmail(identity.email)
  if (existing) return { userId: String(existing._id), created: false }

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

  const provider =
    identity.issuer === 'firebase'
      ? `firebase:${identity.signInProvider ?? 'unknown'}`
      : 'google'

  const { userId, created } = await provisionAccount(args.role, {
    email: identity.email,
    name: identity.name,
    subject: identity.subject,
    provider,
  })

  // Keep the account's last-auth stamp current, same as password login.
  const ts = nowEpoch()
  if (args.role === 'cleaner') await cleanerRepo.updateLastAuthAt(userId, ts)
  else await customerRepo.updateLastAuthAt(userId, ts)

  const issued = await sessions.issueSession({ userId, role: args.role, device: args.device })
  return { ...issued, userId, email: identity.email, isNewUser: created, provider }
}
