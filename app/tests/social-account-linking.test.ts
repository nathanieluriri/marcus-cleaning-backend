import { describe, expect, it } from 'vitest'
import { linkTargetFor, type SocialIdentity } from '@/server/services/social-account-service'

/**
 * Regression tests for an account-takeover hole found in review.
 *
 * Firebase will mint a valid ID token for an email/password account whose
 * address was never confirmed. If social sign-in matches an existing account on
 * that email, anyone can register a victim's address in our Firebase project
 * and be handed the victim's account.
 */

const victim = { _id: 'victim-account-id', authProvider: 'google' }
const bySubjectMatch = { _id: 'subject-matched-id', authProvider: 'firebase:google.com' }

function identity(over: Partial<SocialIdentity> = {}): SocialIdentity {
  return {
    email: 'victim@example.com',
    subject: 'attacker-subject',
    provider: 'firebase:password',
    emailVerified: false,
    ...over,
  }
}

describe('linkTargetFor — social account linking', () => {
  it('REFUSES to link an unverified email to an existing account', () => {
    expect(() => linkTargetFor(identity(), null, victim)).toThrowError(
      /Verify your email/i,
    )
  })

  it('throws a 401 with a typed code rather than silently linking', () => {
    try {
      linkTargetFor(identity(), null, victim)
      throw new Error('should have thrown')
    } catch (err) {
      const e = err as { httpStatus?: number; code?: string }
      expect(e.httpStatus).toBe(401)
      expect(e.code).toBe('IDENTITY_EMAIL_UNVERIFIED')
    }
  })

  it('links on a verified email', () => {
    const out = linkTargetFor(identity({ emailVerified: true }), null, victim)
    expect(out).toEqual({ userId: 'victim-account-id' })
  })

  it('prefers the provider subject over the email match', () => {
    const out = linkTargetFor(identity({ emailVerified: true }), bySubjectMatch, victim)
    expect(out).toEqual({ userId: 'subject-matched-id' })
  })

  it('trusts a subject match even when the email is unverified', () => {
    // The subject is issued by the provider and cannot be claimed by anyone
    // else, so it is safe regardless of the email's state.
    const out = linkTargetFor(identity({ emailVerified: false }), bySubjectMatch, null)
    expect(out).toEqual({ userId: 'subject-matched-id' })
  })

  it('returns null when nothing matches, so a new account is created', () => {
    expect(linkTargetFor(identity({ emailVerified: true }), null, null)).toBeNull()
  })

  it('treats a missing emailVerified flag as unverified', () => {
    const { emailVerified: _omitted, ...withoutFlag } = identity()
    void _omitted
    expect(() => linkTargetFor(withoutFlag, null, victim)).toThrowError(/Verify your email/i)
  })
})
