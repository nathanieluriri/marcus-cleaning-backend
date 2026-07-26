import { createRemoteJWKSet, importX509, jwtVerify, decodeProtectedHeader, decodeJwt } from 'jose'
import { getSettings } from '@/server/core/settings'
import { AppError } from '@/server/core/errors'

/**
 * Verification of ID tokens minted by a native sign-in SDK.
 *
 * This is the counterpart to the browser redirect flow in google-oauth-service:
 * there, the server drives the dance; here, the APP drives it with a native SDK
 * and hands us the resulting ID token to verify and exchange for our own tokens.
 * That is the only shape that works for native Android/iOS, where there is no
 * browser round-trip to own.
 *
 * Two issuers are accepted, distinguished by the token's `iss` claim:
 *
 *   Firebase  iss = https://securetoken.google.com/<projectId>
 *             aud = <projectId>
 *             Covers Google, Apple, Facebook, email/password — anything wired
 *             into the Firebase project. ONE code path for every provider and
 *             every platform.
 *
 *   Google    iss = (https://)accounts.google.com
 *             aud = one of the configured OAuth client ids
 *             For a bare Google Sign-In SDK integration with no Firebase.
 *
 * Firebase signs with rotating x509 certificates rather than a JWKS document,
 * so those are fetched and cached separately. Google publishes a real JWKS, so
 * `jose` handles rotation there.
 *
 * No HTTP/Hono types — reusable by routes, tests and future admin tooling.
 */

const FIREBASE_ISSUER_PREFIX = 'https://securetoken.google.com/'
const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export interface VerifiedIdentity {
  /** Stable provider subject — the primary account link key. */
  subject: string
  email: string
  emailVerified: boolean
  name?: string
  pictureUrl?: string
  /** Which issuer minted the token. */
  issuer: 'firebase' | 'google'
  /** Underlying provider when Firebase reports one (google.com, apple.com, ...). */
  signInProvider?: string
}

// --- Firebase certificate cache --------------------------------------------

interface CertCache {
  certs: Record<string, string>
  /** Epoch ms after which the cache is stale (driven by the response's max-age). */
  expiresAt: number
}

const g = global as typeof globalThis & { _firebaseCerts?: CertCache }

/** Fetch and cache Firebase's signing certificates, honouring their Cache-Control. */
async function firebaseCerts(): Promise<Record<string, string>> {
  const now = Date.now()
  if (g._firebaseCerts && g._firebaseCerts.expiresAt > now) return g._firebaseCerts.certs

  const res = await fetch(FIREBASE_CERT_URL)
  if (!res.ok) {
    throw new AppError(503, 'IDENTITY_KEYS_UNAVAILABLE', 'Could not fetch Firebase signing keys', {
      status: res.status,
    })
  }
  const certs = (await res.json()) as Record<string, string>

  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600)
  g._firebaseCerts = { certs, expiresAt: now + maxAge * 1000 }
  return certs
}

function requireFirebaseProject(): string {
  const projectId = getSettings().FIREBASE_PROJECT_ID ?? getSettings().FCM_PROJECT_ID
  if (!projectId) {
    throw new AppError(500, 'IDENTITY_NOT_CONFIGURED', 'Firebase sign-in is not configured', {
      missing: 'FIREBASE_PROJECT_ID',
    })
  }
  return projectId
}

function invalid(reason: string, details?: unknown): AppError {
  return new AppError(401, 'IDENTITY_TOKEN_INVALID', reason, details)
}

async function verifyFirebaseToken(idToken: string): Promise<VerifiedIdentity> {
  const projectId = requireFirebaseProject()

  const header = decodeProtectedHeader(idToken)
  if (!header.kid) throw invalid('Token is missing a key id')

  const certs = await firebaseCerts()
  const pem = certs[header.kid]
  if (!pem) throw invalid('Token was signed with an unknown key')

  const key = await importX509(pem, 'RS256')
  const { payload } = await jwtVerify(idToken, key, {
    issuer: `${FIREBASE_ISSUER_PREFIX}${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  })

  // Firebase puts the real subject in `sub`; `auth_time` guards against replay
  // of a token minted before the user actually authenticated.
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  if (!sub) throw invalid('Token is missing a subject')
  if (typeof payload.auth_time === 'number' && payload.auth_time > Math.floor(Date.now() / 1000) + 60) {
    throw invalid('Token authentication time is in the future')
  }

  const firebase = (payload.firebase ?? {}) as { sign_in_provider?: string }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  if (!email) {
    // Apple's "hide my email" still yields a relay address, so a missing email
    // means the provider was not configured to share one.
    throw invalid('Token does not carry an email address', {
      signInProvider: firebase.sign_in_provider ?? null,
    })
  }

  return {
    subject: sub,
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    pictureUrl: typeof payload.picture === 'string' ? payload.picture : undefined,
    issuer: 'firebase',
    signInProvider: firebase.sign_in_provider,
  }
}

/** Client ids a bare Google ID token may be addressed to (web, android, ios). */
function googleAudiences(): string[] {
  const s = getSettings()
  const raw = [s.GOOGLE_CLIENT_ID, s.GOOGLE_IOS_CLIENT_ID, s.GOOGLE_ANDROID_CLIENT_ID]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(',').map((x) => x.trim()))
    .filter(Boolean)
  if (raw.length === 0) {
    throw new AppError(500, 'IDENTITY_NOT_CONFIGURED', 'Google sign-in is not configured', {
      missing: 'GOOGLE_CLIENT_ID',
    })
  }
  return [...new Set(raw)]
}

async function verifyGoogleToken(idToken: string): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: GOOGLE_ISSUERS,
    audience: googleAudiences(),
    algorithms: ['RS256'],
  })

  const sub = typeof payload.sub === 'string' ? payload.sub : null
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  if (!sub || !email) throw invalid('Google identity is missing a subject or email')

  return {
    subject: sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' ? payload.name : undefined,
    pictureUrl: typeof payload.picture === 'string' ? payload.picture : undefined,
    issuer: 'google',
  }
}

/**
 * Verify an ID token from either supported issuer, routing on the `iss` claim.
 *
 * The claim is read WITHOUT verifying first — that is safe because it only
 * selects which verifier runs, and each verifier then pins its own issuer,
 * audience and signing keys. An attacker cannot use it to skip verification.
 */
export async function verifyIdentityToken(idToken: string): Promise<VerifiedIdentity> {
  let issuer: string
  try {
    issuer = String(decodeJwt(idToken).iss ?? '')
  } catch {
    throw invalid('Token is not a well-formed JWT')
  }

  if (issuer.startsWith(FIREBASE_ISSUER_PREFIX)) return verifyFirebaseToken(idToken)
  if (GOOGLE_ISSUERS.includes(issuer)) return verifyGoogleToken(idToken)

  throw invalid('Token issuer is not accepted', { issuer })
}
