import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { getSettings } from '@/server/core/settings'
import { authInvalidToken } from '@/server/core/errors'
import type { Audience, Role } from './principal'

/**
 * Self-issued access tokens (jose, HS256).
 * Access tokens are stateless; refresh tokens are opaque + DB-tracked (see session-repo).
 *
 * Hardening: always pin the algorithm allow-list and verify issuer + audience.
 * See: ../../../docs/migration/03-auth.md
 */

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSettings().JWT_SECRET)
}

export interface AccessClaims {
  sub: string
  role: Role
  audience: Audience
  sessionId: string
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const { JWT_ISSUER, ACCESS_TOKEN_TTL_SECONDS } = getSettings()
  return new SignJWT({ role: claims.role, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(claims.audience)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey())
}

type RawAccessPayload = JWTPayload & { role?: string; sid?: string }

/** Verify an access token for a specific audience. Throws AppError(401) on failure. */
export async function verifyAccessToken(token: string, audience: Audience): Promise<AccessClaims> {
  const { JWT_ISSUER } = getSettings()
  try {
    const { payload } = await jwtVerify<RawAccessPayload>(token, secretKey(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience,
    })
    if (!payload.sub || !payload.role || !payload.sid) {
      throw authInvalidToken({ reason: 'Missing required claims' })
    }
    return {
      sub: payload.sub,
      role: payload.role as Role,
      audience,
      sessionId: payload.sid,
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'AUTH_INVALID_TOKEN') {
      throw err
    }
    throw authInvalidToken({ reason: err instanceof Error ? err.message : 'verify failed' })
  }
}

/**
 * Lightweight claim read for rate-limit keying only: verifies signature + issuer
 * but NOT audience. Returns null on any failure. Never use for authorization.
 */
export async function peekAccessClaims(token: string): Promise<{ sub: string; role: string } | null> {
  const { JWT_ISSUER } = getSettings()
  try {
    const { payload } = await jwtVerify<RawAccessPayload>(token, secretKey(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
    })
    if (!payload.sub || !payload.role) return null
    return { sub: payload.sub, role: payload.role }
  } catch {
    return null
  }
}
