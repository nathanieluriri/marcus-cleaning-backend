import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getSettings } from '@/server/core/settings'
import { AppError, badRequest } from '@/server/core/errors'
import type { Role } from '@/server/security/principal'
import * as oauthStateRepo from '@/server/repositories/oauth-state-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as sessions from './auth-session-service'
import type { DeviceInfo, IssuedTokens } from './auth-session-service'

/**
 * Server-side Google OAuth (authorization-code + PKCE). We issue OUR OWN tokens;
 * Google's tokens are discarded after we verify the id_token.
 *
 * Flow (see docs/migration/03-auth.md):
 *   buildAuthUrl(role) → redirect user to Google with state + PKCE S256 challenge.
 *   handleCallback(role, code, state) → verify state, exchange code server-side
 *     (client_secret + code_verifier), verify Google id_token via JWKS, extract
 *     sub+email, provision/find the account, issueSession().
 *
 * No HTTP/Hono types here — reusable by routes and tests.
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const STATE_TTL_MS = 10 * 60 * 1000

// Cached JWKS for Google's id_token signing keys (jose handles key rotation/caching).
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function requireOAuthConfig() {
  const s = getSettings()
  if (!s.GOOGLE_CLIENT_ID || !s.GOOGLE_CLIENT_SECRET || !s.GOOGLE_REDIRECT_URI) {
    throw new AppError(500, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured')
  }
  return {
    clientId: s.GOOGLE_CLIENT_ID,
    clientSecret: s.GOOGLE_CLIENT_SECRET,
    redirectUri: s.GOOGLE_REDIRECT_URI,
  }
}

/** Build the Google authorization URL, persisting state + PKCE verifier. */
export async function buildAuthUrl(role: Role): Promise<{ url: string; state: string }> {
  const { clientId, redirectUri } = requireOAuthConfig()

  const state = base64url(randomBytes(32))
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())

  const now = new Date()
  await oauthStateRepo.insert({
    state,
    codeVerifier,
    role,
    createdAt: now,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
  })

  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, state }
}

interface GoogleTokenResponse {
  id_token?: string
  access_token?: string
  error?: string
  error_description?: string
}

async function exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = requireOAuthConfig()
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  if (!res.ok || json.error || !json.id_token) {
    throw new AppError(401, 'OAUTH_EXCHANGE_FAILED', 'Failed to exchange Google authorization code', {
      status: res.status,
      error: json.error ?? null,
      description: json.error_description ?? null,
    })
  }
  return json
}

async function verifyIdToken(idToken: string): Promise<{ sub: string; email: string; name?: string }> {
  const { clientId } = requireOAuthConfig()
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ['accounts.google.com', 'https://accounts.google.com'],
    audience: clientId,
  })
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  const email = typeof payload.email === 'string' ? payload.email : null
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  if (!sub || !email) {
    throw new AppError(401, 'OAUTH_IDENTITY_INVALID', 'Google identity missing subject or email')
  }
  if (!emailVerified) {
    throw new AppError(401, 'OAUTH_EMAIL_UNVERIFIED', 'Google account email is not verified')
  }
  return { sub, email: email.toLowerCase(), name: typeof payload.name === 'string' ? payload.name : undefined }
}

function splitName(name: string | undefined, email: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { firstName: email.split('@')[0] ?? 'User', lastName: '' }
  const parts = trimmed.split(/\s+/)
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Provision-or-find a customer account from a verified Google identity; returns its id. */
async function provisionCustomer(identity: { email: string; name?: string }): Promise<string> {
  const existing = await customerRepo.findByEmail(identity.email)
  if (existing) return String(existing._id)
  const { firstName, lastName } = splitName(identity.name, identity.email)
  const ts = nowEpoch()
  const created = await customerRepo.insertCustomer({
    firstName,
    lastName,
    email: identity.email,
    // OAuth accounts have no local password; store a random unusable hash placeholder.
    password: `google-oauth:${randomUUID()}`,
    phoneNumber: null,
    avatarDocumentId: null,
    accountStatus: 'ACTIVE',
    loginType: 'google',
    emailVerified: true,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: 'google',
    authSubject: identity.email,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })
  return created.id
}

/** Provision-or-find a cleaner account from a verified Google identity; returns its id. */
async function provisionCleaner(identity: { email: string; name?: string }): Promise<string> {
  const existing = await cleanerRepo.findByEmail(identity.email)
  if (existing) return String(existing._id)
  const { firstName, lastName } = splitName(identity.name, identity.email)
  const ts = nowEpoch()
  const created = await cleanerRepo.insertCleaner({
    firstName,
    lastName,
    email: identity.email,
    password: `google-oauth:${randomUUID()}`,
    phoneNumber: null,
    accountStatus: 'ACTIVE',
    loginType: 'google',
    onboardingStatus: 'NOT_STARTED',
    allowAdminSelection: false,
    emailVerified: true,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: 'google',
    authSubject: identity.email,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })
  return created.id
}

/**
 * Complete the OAuth callback: verify state, exchange the code, verify the
 * id_token, provision/find the account, and issue our own session.
 */
export async function handleCallback(args: {
  role: Role
  code: string
  state: string
  device: DeviceInfo
}): Promise<IssuedTokens & { userId: string; email: string }> {
  if (!args.code || !args.state) throw badRequest('Missing OAuth code or state')

  const stored = await oauthStateRepo.consume(args.state)
  if (!stored) throw new AppError(401, 'OAUTH_STATE_INVALID', 'Invalid or expired OAuth state')
  if (stored.role !== args.role) {
    throw new AppError(401, 'OAUTH_STATE_ROLE_MISMATCH', 'OAuth state was issued for a different role')
  }

  const tokens = await exchangeCode(args.code, stored.codeVerifier)
  const identity = await verifyIdToken(tokens.id_token as string)

  const userId =
    args.role === 'cleaner'
      ? await provisionCleaner({ email: identity.email, name: identity.name })
      : await provisionCustomer({ email: identity.email, name: identity.name })

  const issued = await sessions.issueSession({ userId, role: args.role, device: args.device })
  return { ...issued, userId, email: identity.email }
}
