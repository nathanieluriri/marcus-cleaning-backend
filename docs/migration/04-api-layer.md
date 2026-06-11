# 04 — API Layer (Hono + zod-openapi)

Decision **D2/D3**: the API is a **Hono** app mounted as a single Next.js catch-all route, with routes defined via **`@hono/zod-openapi`** so validation and the OpenAPI 3.1 spec come from the same Zod schemas.

## Building the app

```ts
// src/server/app.ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { requestId } from 'hono/request-id'
import { cors } from 'hono/cors'
import type { RequestIdVariables } from 'hono/request-id'
import { timing } from './core/request-context'
import { locale } from './core/i18n'
import { rateLimit } from './core/rate-limit'
import { mountDocs } from './core/openapi'
import { failHook } from './core/envelope'
import type { AuthPrincipal } from './security/principal'

import { customers } from './routes/customers'
import { cleaners } from './routes/cleaners'
import { admins } from './routes/admins'
import { bookings } from './routes/bookings'
import { payments } from './routes/payments'
import { places } from './routes/places'
import { documents } from './routes/documents'
import { reviews } from './routes/reviews'
import { notifications } from './routes/notifications'
import { banners } from './routes/banners'
import { health } from './routes/health'
import { cron } from './routes/cron'

export type Env = {
  Variables: RequestIdVariables & {
    principal: AuthPrincipal | null
    locale: 'en' | 'fr'
  }
}

export const app = new OpenAPIHono<Env>({ defaultHook: failHook })

// --- global middleware (order matters) ---
app.use('*', requestId())                 // X-Request-Id in/out
app.use('*', timing())                    // X-Process-Time
app.use('/api/*', cors({                  // per-client allow-list, see 12
  origin: (origin) => allowedOrigins.includes(origin) ? origin : null,
  allowMethods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowHeaders: ['Content-Type','Authorization','Accept-Language','X-Request-ID'],
  exposeHeaders: ['X-Request-Id','X-Process-Time','X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset','Retry-After','Content-Language'],
  credentials: true,
}))
app.use('/api/*', locale())               // Accept-Language → c.set('locale')
app.use('/api/*', rateLimit())            // Upstash, per role

// --- routers (mirror current /v1 + /web mounts) ---
app.route('/api/v1/customers', customers)
app.route('/api/v1/cleaners', cleaners)
app.route('/api/v1/admins', admins)        // admin features nested inside (see 07)
app.route('/api/v1/bookings', bookings)
app.route('/api/v1/payments', payments)
app.route('/api/v1/places', places)
app.route('/api/v1/documents', documents)
app.route('/api/v1/reviews', reviews)
app.route('/api/v1/notifications', notifications)
app.route('/api/v1/banners', banners)
app.route('/api', health)                  // /api/health, /api
app.route('/api/cron', cron)               // secured by CRON_SECRET (see 10)

// --- docs ---
mountDocs(app)                             // /api/doc (spec) + /api/reference (Scalar)
```

> **Path note:** the spec must reflect the `/api` prefix even though `@hono/zod-openapi` does not fold a Hono `basePath` into emitted paths. We solve this with a `servers: [{ url: '/api' }]` entry in the doc config (see `05`) and write each `createRoute({ path })` **relative to its router mount** (e.g. `/{booking_id}` inside the bookings router). Keep this convention consistent.

## Defining a route (the standard pattern)

```ts
// src/server/routes/bookings.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Env } from '../app'
import { requireCustomer } from '../security/guards'
import { ok, envelopeOf } from '../core/envelope'
import { BookingCustomerCreateRequest, BookingOut } from '../schemas/booking'
import * as bookingService from '../services/booking-service'

export const bookings = new OpenAPIHono<Env>()

const createBooking = createRoute({
  method: 'post',
  path: '/',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } },
  },
  responses: {
    201: {
      description: 'Booking created successfully',
      content: { 'application/json': { schema: envelopeOf(BookingOut) } },
    },
  },
})

bookings.use('/', requireCustomer())        // guard middleware (sets principal)
bookings.openapi(createBooking, async (c) => {
  const payload = c.req.valid('json')        // validated + typed
  const principal = c.get('principal')!
  const data = await bookingService.createBookingForCustomer({ principal, payload })
  return c.json(ok(c, 'Booking created successfully', data), 201)
})
```

Conventions:
- Path params in `createRoute` use `{id}` syntax (OpenAPI), and Zod param schemas mark them with `.openapi({ param: { name, in: 'path' } })`.
- `c.req.valid('json' | 'query' | 'param' | 'header')` returns parsed/typed input. Validation failures are routed through `defaultHook` → envelope (below).
- Handlers stay thin: validate → call service → wrap in envelope. **No DB access in handlers.**

## Response envelope (ported from `core/response_envelope.py`)

Every response keeps the shape `{ success, message, data, requestId }`.

```ts
// src/server/core/envelope.ts
import type { Context } from 'hono'
import { z } from '@hono/zod-openapi'
import type { Env } from '../app'

export function ok<T>(c: Context<Env>, message: string, data: T) {
  return { success: true, message, data, requestId: c.get('requestId') }
}

export function fail(c: Context<Env>, message: string, code: string, details?: unknown) {
  return { success: false, message, data: { code, details }, requestId: c.get('requestId') }
}

// Wrap any payload schema in the envelope for OpenAPI responses.
export function envelopeOf<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data,
    requestId: z.string().nullable(),
  })
}

// zod-openapi defaultHook: turn validation errors into the envelope (422), localized.
export const failHook = (result: { success: boolean; error?: z.ZodError }, c: Context<Env>) => {
  if (!result.success) {
    return c.json(
      fail(c, translate('Validation error', c.get('locale')), 'VALIDATION_FAILED',
           formatZodIssues(result.error!)),
      422,
    )
  }
}
```

This matches the current validation envelope (`{code: 'VALIDATION_FAILED', details: [...] }`) and the 422 status.

## Errors (ported from `core/errors.py`)

Typed application errors map to envelope responses with stable `code`s and HTTP statuses. Ported error constructors include the auth errors (`auth_invalid_token`, `auth_role_mismatch`) and the generic catalog.

```ts
// src/server/core/errors.ts
export class AppError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) { super(message) }
}
export const authInvalidToken = (details?: unknown) =>
  new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired token', details)
export const authRoleMismatch = (required: string, actual: string | null) =>
  new AppError(403, 'AUTH_ROLE_MISMATCH', 'Role not permitted', { required, actual })
export const tooManyRequests = (retryAfter: number, userType: string) =>
  new AppError(429, 'TOO_MANY_REQUESTS', 'Too Many Requests', { retry_after_seconds: retryAfter, user_type: userType })
```

A single `onError` handler converts `AppError` → envelope, and any unexpected error → `500 INTERNAL_ERROR` (details only when `DEBUG_INCLUDE_ERROR_DETAILS` and not production — preserving current behavior):

```ts
app.onError((err, c) => {
  if (err instanceof AppError)
    return c.json(fail(c, translate(err.message, c.get('locale')), err.code, err.details), err.httpStatus)
  const details = settings.DEBUG_INCLUDE_ERROR_DETAILS && !settings.IS_PRODUCTION ? String(err) : undefined
  return c.json(fail(c, translate('Internal Server Error', c.get('locale')), 'INTERNAL_ERROR', details), 500)
})
```

## Guard middleware (ported from `security/auth.py`)

Each `verify_*` dependency becomes a middleware factory that verifies the bearer token for the expected audience, resolves the `AuthPrincipal`, enforces account status + session policy, optionally checks the permission key, and sets `c.set('principal', ...)`.

```ts
// src/server/security/guards.ts
import { createMiddleware } from 'hono/factory'
import type { Env } from '../app'
import { authInvalidToken, authRoleMismatch } from '../core/errors'

export const requireRole = (role: 'customer'|'cleaner'|'admin', audience: string, permissionKey?: string) =>
  createMiddleware<Env>(async (c, next) => {
    const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!bearer) throw authInvalidToken({ reason: 'missing bearer' })
    const principal = await resolvePrincipal(bearer, role, audience) // verify + load account + policy
    if (principal.role !== role) throw authRoleMismatch(role, principal.role)
    if (permissionKey) await assertPermission(principal, permissionKey)
    c.set('principal', principal)
    await next()
  })

export const requireCustomer = (perm?: string) => requireRole('customer', 'customer-mobile', perm)
export const requireCleaner  = (perm?: string) => requireRole('cleaner', 'cleaner-mobile', perm)
export const requireAdmin    = (perm?: string) => requireRole('admin', 'admin-web', perm)
```

Refresh-token guards (`requireCustomerRefresh`, etc.) use the refresh verification path from `03` instead of access-token verification.

## Middleware order rationale

`requestId` → `timing` → `cors` → `locale` → `rateLimit` → (route-scoped) `auth` → `permission`. Request id is first so every downstream log/response carries it; rate limiting runs before auth-heavy work but resolves the caller's role the same way the current `get_user_type` does (local token first, then fall back to anonymous) — see `12`.

## Cross-references

- OpenAPI doc + Scalar: `05-api-docs-scalar.md`
- Endpoint inventory: `07-domain-endpoints.md`
- Rate limiting + i18n internals: `12-rate-limiting-i18n.md`
- Auth verification details: `03-auth.md`
