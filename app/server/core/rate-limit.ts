import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createMiddleware } from 'hono/factory'
import type { Duration } from '@upstash/ratelimit'
import type { Env } from './http-env'
import { getSettings } from './settings'
import { getRoleRateLimits, normalizeRole } from './role-config'
import { tooManyRequests } from './errors'
import { peekAccessClaims } from '@/server/security/jwt'

/**
 * Per-role fixed-window rate limiting on Upstash Redis.
 * Ported from the Redis limiter in `main.py` (RateLimitingMiddleware + get_user_type).
 *
 * If Upstash is not configured (local dev), limiting is skipped but the
 * X-RateLimit-* headers are still emitted from the role rule.
 *
 * See: ../../../docs/migration/12-rate-limiting-i18n.md
 */

let limiters: Record<string, Ratelimit> | null = null

function getLimiters(): Record<string, Ratelimit> | null {
  if (limiters) return limiters
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = getSettings()
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null
  const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })
  limiters = Object.fromEntries(
    Object.entries(getRoleRateLimits()).map(([role, rule]) => [
      role,
      new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(rule.amount, `${rule.windowSeconds} s` as Duration),
        prefix: `rl:${role}`,
        analytics: false,
        ephemeralCache: new Map(),
      }),
    ]),
  )
  return limiters
}

function clientIp(c: Parameters<Parameters<typeof createMiddleware<Env>>[0]>[0]): string {
  const fwd = c.req.header('X-Forwarded-For')
  if (fwd) return fwd.split(',')[0].trim()
  return c.req.header('X-Real-IP') ?? 'anonymous'
}

async function resolveCaller(
  c: Parameters<Parameters<typeof createMiddleware<Env>>[0]>[0],
): Promise<{ id: string; role: string }> {
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const claims = await peekAccessClaims(auth.slice(7))
    if (claims) {
      const role = normalizeRole(claims.role)
      if (role !== 'anonymous') return { id: claims.sub, role }
    }
  }
  return { id: clientIp(c), role: 'anonymous' }
}

export const rateLimit = () =>
  createMiddleware<Env>(async (c, next) => {
    const rules = getRoleRateLimits()
    const { id, role } = await resolveCaller(c)
    const rule = rules[role] ?? rules.anonymous
    const ls = getLimiters()

    c.header('X-User-Id', id)
    c.header('X-User-Type', role)
    c.header('X-RateLimit-Limit', String(rule.amount))

    if (!ls) {
      // Upstash not configured (dev) — skip enforcement but keep headers consistent.
      c.header('X-RateLimit-Remaining', String(rule.amount))
      c.header('X-RateLimit-Reset', String(rule.windowSeconds))
      await next()
      return
    }

    const limiter = ls[role] ?? ls.anonymous
    const { success, limit, remaining, reset } = await limiter.limit(id)
    const resetSeconds = Math.max(Math.ceil((reset - Date.now()) / 1000), 0)

    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(Math.max(remaining, 0)))
    c.header('X-RateLimit-Reset', String(resetSeconds))

    if (!success) {
      c.header('Retry-After', String(resetSeconds))
      throw tooManyRequests(resetSeconds, role)
    }
    await next()
  })
