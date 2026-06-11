# 12 — Rate Limiting, Caching & i18n

Two cross-cutting concerns from the current `main.py` middleware and `core/i18n.py` that must be preserved.

## Rate limiting (Upstash, per role)

The current backend uses a Redis fixed-window limiter keyed by resolved `(user_id, user_type)`, with per-role limits and `X-RateLimit-*` headers (`build_role_rate_limits`, `core/role_config.py`). Port this to **Upstash Redis** via `@upstash/ratelimit`.

### Resolving the caller (ported from `get_user_type`)

The current logic: try the local access token first; if it resolves to a known role with a user id, key by that; else fall back to Auth0 claims; else `anonymous` keyed by `X-Forwarded-For`/client IP. In the unified model this simplifies:

1. If a valid bearer access token → key `(userId, role)`.
2. Else → key `(clientIp, 'anonymous')` using `X-Forwarded-For` (Vercel sets it) or the connecting IP.

```ts
// src/server/core/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createMiddleware } from 'hono/factory'
import type { Env } from '../app'
import { roleRateLimits } from './role-config'   // ported from core/role_config.py
import { tooManyRequests } from './errors'

const redis = Redis.fromEnv()   // reads UPSTASH_REDIS_REST_URL/TOKEN

// One limiter per role (fixed window to match current semantics).
const limiters = Object.fromEntries(
  Object.entries(roleRateLimits).map(([role, rule]) => [
    role,
    new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(rule.amount, rule.window), prefix: `rl:${role}` }),
  ]),
)

export const rateLimit = () => createMiddleware<Env>(async (c, next) => {
  const { id, role } = await resolveCaller(c)            // (userId,role) or (ip,'anonymous')
  const limiter = limiters[role] ?? limiters['anonymous']
  const { success, limit, remaining, reset } = await limiter.limit(id)
  const resetSeconds = Math.max(Math.ceil((reset - Date.now()) / 1000), 0)

  c.header('X-User-Id', id)
  c.header('X-User-Type', role)
  c.header('X-RateLimit-Limit', String(limit))
  c.header('X-RateLimit-Remaining', String(Math.max(remaining, 0)))
  c.header('X-RateLimit-Reset', String(resetSeconds))

  if (!success) {
    c.header('Retry-After', String(resetSeconds))
    throw tooManyRequests(resetSeconds, role)   // → 429 envelope via onError
  }
  await next()
})
```

### Role rate-limit config (ported)

`core/role_config.py` (`build_role_rate_limits`, `build_role_rate_limits_csv`, `normalize_role`) → `core/role-config.ts`. Defaults mirror current (`anonymous`, `cleaner`, `customer`, `admin`); overridable via `ROLE_RATE_LIMITS` CSV (e.g. `anonymous:20/minute,cleaner:80/minute,customer:80/minute,admin:140/minute`).

### Headers parity

Preserve exactly: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on 429. The 429 body uses the envelope with `code: TOO_MANY_REQUESTS` and `details: { retry_after_seconds, user_type }` — matching the current response.

> **Serverless note:** Upstash's REST limiter adds one network round-trip per request. `@upstash/ratelimit` supports an in-memory `ephemeralCache` to short-circuit already-blocked keys within a warm instance — enable it to reduce calls.

## Caching (Upstash)

`core/redis_cache.py` and `core/cleaner_onboarding_cache.py` → `core/cache.ts` over Upstash Redis (`get`/`set`/`del` with TTL). Same key conventions. Use for places autocomplete caching, onboarding status cache, and any hot reads. Cache is best-effort — never the source of truth.

## i18n (en/fr, ported from `core/i18n.py`)

Behavior to preserve:
- Supported response languages: **`en` and `fr`**.
- `Accept-Language` is validated to supported values; invalid → `422` with the validation envelope (matching the current `LocaleMiddleware` behavior).
- For authenticated routes, the account's `preferredLanguage` takes precedence over the header.
- Default language is `en`.
- Responses set `Content-Language`. Auth token responses include a top-level `language` field.

```ts
// src/server/core/i18n.ts
import { createMiddleware } from 'hono/factory'
import type { Env } from '../app'
import { validationError } from './errors'

const SUPPORTED = ['en', 'fr'] as const
type Lang = typeof SUPPORTED[number]

export function parseAcceptLanguage(header?: string): Lang {
  if (!header) return 'en'
  const tag = header.split(',')[0]?.trim().slice(0, 2).toLowerCase()
  if (tag && SUPPORTED.includes(tag as Lang)) return tag as Lang
  throw validationError({ field: 'Accept-Language' })   // → 422 envelope
}

export const locale = () => createMiddleware<Env>(async (c, next) => {
  const lang = parseAcceptLanguage(c.req.header('Accept-Language'))
  c.set('locale', lang)
  await next()
  c.header('Content-Language', c.get('locale'))
})

// translate(message, lang) backed by the ported message catalog.
```

The message catalog (the en/fr strings used by `translate_message`) ports to a `messages.ts` map. After auth resolves, services may override `c.set('locale', account.preferredLanguage)` so localized messages use the account preference.

## Cross-references

- Middleware order: `04-api-layer.md`
- Caller resolution / auth: `03-auth.md`
- Upstash provisioning + env: `11-infra-and-env.md`
