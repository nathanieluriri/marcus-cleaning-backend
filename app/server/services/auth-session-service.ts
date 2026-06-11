import { randomUUID } from 'node:crypto'
import { getSettings } from '@/server/core/settings'
import { authInvalidToken } from '@/server/core/errors'
import { signAccessToken } from '@/server/security/jwt'
import { generateRefreshToken, sha256 } from '@/server/security/hash'
import { ROLE_TO_AUDIENCE, type Audience, type Role } from '@/server/security/principal'
import * as sessionRepo from '@/server/repositories/session-repo'
import type { SessionDoc } from '@/server/repositories/session-repo'

/**
 * Session / token lifecycle: issue, rotate (with reuse detection), revoke.
 * Ported from `auth_session_service.py`. HTTP-agnostic so cron/tests can reuse it.
 * See: docs/migration/03-auth.md
 */

export interface DeviceInfo {
  userAgent: string | null
  ip: string | null
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  sessionId: string
}

function isWebAudience(audience: Audience): boolean {
  return audience === 'admin-web'
}

function refreshExpiry(audience: Audience, familyIssuedAt: Date, now: Date): Date {
  const s = getSettings()
  if (isWebAudience(audience)) {
    return new Date(now.getTime() + s.REFRESH_TTL_WEB_SECONDS * 1000)
  }
  // Mobile: sliding idle window, capped at an absolute lifetime from family start.
  const idle = now.getTime() + s.REFRESH_IDLE_MOBILE_SECONDS * 1000
  const absolute = familyIssuedAt.getTime() + s.REFRESH_ABSOLUTE_MOBILE_SECONDS * 1000
  return new Date(Math.min(idle, absolute))
}

/** Create a brand-new session family (login / signup). */
export async function issueSession(args: {
  userId: string
  role: Role
  device: DeviceInfo
  audience?: Audience
}): Promise<IssuedTokens> {
  const now = new Date()
  const audience = args.audience ?? ROLE_TO_AUDIENCE[args.role]
  const sessionId = randomUUID()
  const refreshToken = generateRefreshToken()

  await sessionRepo.insertSession({
    userId: args.userId,
    role: args.role,
    sessionId,
    tokenHash: sha256(refreshToken),
    audience,
    deviceInfo: args.device,
    familyIssuedAt: now,
    issuedAt: now,
    lastUsedAt: now,
    expiresAt: refreshExpiry(audience, now, now),
    usedAt: null,
    replacedBy: null,
    revokedAt: null,
  })

  const accessToken = await signAccessToken({ sub: args.userId, role: args.role, audience, sessionId })
  return { accessToken, refreshToken, expiresIn: getSettings().ACCESS_TOKEN_TTL_SECONDS, sessionId }
}

/**
 * Rotate a refresh token. Returns new tokens + the resolved identity.
 * Implements reuse detection: a consumed token outside the grace window
 * revokes the whole family.
 */
export async function rotateRefresh(args: {
  presentedToken: string
  device: DeviceInfo
  expectedRole?: Role
}): Promise<IssuedTokens & { userId: string; role: Role }> {
  const now = new Date()
  const tokenHash = sha256(args.presentedToken)
  const session = await sessionRepo.findByTokenHash(tokenHash)

  if (!session) throw authInvalidToken({ reason: 'Unknown refresh token' })
  if (session.revokedAt) throw authInvalidToken({ reason: 'Session revoked' })
  if (session.expiresAt.getTime() < now.getTime()) {
    throw authInvalidToken({ reason: 'Refresh token expired' })
  }
  if (args.expectedRole && session.role !== args.expectedRole) {
    throw authInvalidToken({ reason: 'Role mismatch for refresh token' })
  }

  if (session.usedAt) {
    const graceMs = getSettings().REFRESH_REUSE_GRACE_SECONDS * 1000
    const withinGrace = now.getTime() - session.usedAt.getTime() <= graceMs
    if (withinGrace && session.replacedBy) {
      // Benign race: the client raced its own refresh. Ask it to retry with its newest token.
      throw authInvalidToken({ reason: 'Refresh race; retry with latest token', retryable: true })
    }
    // Reuse of a consumed token → theft. Revoke the entire family.
    await sessionRepo.revokeFamily(session.sessionId, 'reuse-detected', now)
    throw authInvalidToken({ reason: 'Refresh token reuse detected' })
  }

  // Legitimate rotation.
  const newToken = generateRefreshToken()
  const newHash = sha256(newToken)
  await sessionRepo.markConsumed(tokenHash, newHash, now)

  const newDoc: SessionDoc = {
    userId: session.userId,
    role: session.role,
    sessionId: session.sessionId,
    tokenHash: newHash,
    audience: session.audience,
    deviceInfo: args.device,
    familyIssuedAt: session.familyIssuedAt,
    issuedAt: now,
    lastUsedAt: now,
    expiresAt: refreshExpiry(session.audience, session.familyIssuedAt, now),
    usedAt: null,
    replacedBy: null,
    revokedAt: null,
  }
  await sessionRepo.insertSession(newDoc)

  const accessToken = await signAccessToken({
    sub: session.userId,
    role: session.role,
    audience: session.audience,
    sessionId: session.sessionId,
  })

  return {
    accessToken,
    refreshToken: newToken,
    expiresIn: getSettings().ACCESS_TOKEN_TTL_SECONDS,
    sessionId: session.sessionId,
    userId: session.userId,
    role: session.role,
  }
}

export async function logoutSession(userId: string, sessionId: string): Promise<void> {
  await sessionRepo.revokeSession(userId, sessionId, new Date())
}

export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  return sessionRepo.revokeAllForUser(userId, new Date(), currentSessionId)
}

export async function revokeAllSessions(userId: string): Promise<number> {
  return sessionRepo.revokeAllForUser(userId, new Date())
}
