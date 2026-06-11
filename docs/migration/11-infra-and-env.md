# 11 — Infrastructure & Environment

Covers Vercel project config, the env-var mapping (old→new), and the managed services (Atlas, Upstash, Resend, S3).

## Settings module (Zod-validated env)

Port `core/settings.py` to `core/settings.ts`. The current code validates required env at startup (`collect_missing_required_env_vars`, `collect_invalid_env_values`); reproduce that with a Zod schema parsed once at module load — a missing/invalid var fails fast on the first cold start.

```ts
// src/server/core/settings.ts
import { z } from 'zod'

const Env = z.object({
  // runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ENV: z.enum(['development', 'production']).default('development'),
  DEBUG_INCLUDE_ERROR_DETAILS: z.coerce.boolean().default(false),

  // db
  MONGODB_URI: z.string().url(),
  DB_NAME: z.string().min(1),

  // auth (NEW — replaces Auth0 + local secrets)
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('marcus-backend'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_WEB_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),
  REFRESH_IDLE_MOBILE_SECONDS: z.coerce.number().default(60 * 60 * 24 * 60),
  REFRESH_ABSOLUTE_MOBILE_SECONDS: z.coerce.number().default(60 * 60 * 24 * 180),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().default(20),
  SESSION_SECRET_KEY: z.string().min(16),           // if cookie signing is used for web

  // per-role session policy (carried over)
  AUTH_SESSION_MAX_AGE_ADMIN_SECONDS: z.coerce.number(),
  AUTH_SESSION_MAX_AGE_CLEANER_SECONDS: z.coerce.number(),
  AUTH_SESSION_MAX_AGE_CUSTOMER_SECONDS: z.coerce.number(),
  AUTH_SESSION_IDLE_TIMEOUT_ADMIN_SECONDS: z.coerce.number(),
  AUTH_SESSION_IDLE_TIMEOUT_CLEANER_SECONDS: z.coerce.number(),
  AUTH_SESSION_IDLE_TIMEOUT_CUSTOMER_SECONDS: z.coerce.number(),

  // google oauth
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_MAPS_API_KEY: z.string(),

  // email (Resend — replaces SMTP)
  RESEND_API_KEY: z.string(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string(),

  // payments
  PAYMENT_DEFAULT_PROVIDER: z.enum(['flutterwave', 'stripe', 'test']).default('flutterwave'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLW_WEBHOOK_SECRET_HASH: z.string().optional(),
  TEST_PAYMENT_BASE_URL: z.string().url().optional(),
  TEST_PAYMENT_WEBHOOK_SECRET_HASH: z.string().optional(),
  SUCCESS_PAGE_URL: z.string().url(),
  ERROR_PAGE_URL: z.string().url(),

  // storage
  STORAGE_BACKEND: z.enum(['local', 's3', 'blob']).default('s3'),
  S3_BUCKET_NAME: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT_URL: z.string().optional(),
  STORAGE_LOCAL_ROOT: z.string().default('uploads'),

  // cache / rate-limit (Upstash — replaces Redis)
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),
  ROLE_RATE_LIMITS: z.string().optional(),

  // cron
  CRON_SECRET: z.string().min(16),

  // misc
  CORS_ORIGINS: z.string().optional(),
  BOOKING_ALLOW_ACCEPT_ON_PENDING_PAYMENT: z.coerce.boolean().default(false),
  PAYMENT_RECONCILE_POLL_LIMIT: z.coerce.number().default(50),
  SUPER_ADMIN_EMAIL: z.string().optional(),
  SUPER_ADMIN_PASSWORD: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.PAYMENT_DEFAULT_PROVIDER === 'stripe' && (!v.STRIPE_SECRET_KEY || !v.STRIPE_WEBHOOK_SECRET))
    ctx.addIssue({ code: 'custom', message: 'Stripe provider requires STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET' })
  if (v.PAYMENT_DEFAULT_PROVIDER === 'flutterwave' && (!v.FLUTTERWAVE_SECRET_KEY || !v.FLW_WEBHOOK_SECRET_HASH))
    ctx.addIssue({ code: 'custom', message: 'Flutterwave provider requires FLUTTERWAVE_SECRET_KEY + FLW_WEBHOOK_SECRET_HASH' })
  if (v.STORAGE_BACKEND === 's3' && !v.S3_BUCKET_NAME)
    ctx.addIssue({ code: 'custom', message: 'S3 backend requires S3_BUCKET_NAME' })
})

export const settings = Env.parse(process.env)
export const IS_PRODUCTION = settings.ENV === 'production'
```

## Env-var mapping (old → new)

| Current | New | Status |
|---|---|---|
| `SECRET_KEY` | `JWT_SECRET` | renamed/repurposed (JWT signing) |
| `SESSION_SECRET_KEY` | `SESSION_SECRET_KEY` | kept (web cookie signing) |
| `MONGO_URL` | `MONGODB_URI` | renamed (Atlas/Vercel convention) |
| `DB_NAME` | `DB_NAME` | kept |
| `DB_TYPE` | — | **removed** (Mongo only; sqlite path dropped) |
| `GOOGLE_MAPS_API_KEY` | `GOOGLE_MAPS_API_KEY` | kept |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | same | kept (OAuth) |
| `SUCCESS_PAGE_URL` / `ERROR_PAGE_URL` | same | kept |
| `EMAIL_USERNAME/PASSWORD/HOST/PORT` | `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | **replaced** (SMTP → Resend) |
| `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | — | **removed** (no Celery) |
| `AUTH0_DOMAIN/ISSUER/AUDIENCE/CLIENT_ID/CLIENT_SECRET/DB_CONNECTION` | — | **removed** (no Auth0) |
| `REDIS_URL` | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **replaced** (Upstash REST) |
| `STORAGE_BACKEND`, `S3_*`, `STORAGE_LOCAL_ROOT` | same | kept |
| `PAYMENT_DEFAULT_PROVIDER`, `STRIPE_*`, `FLUTTERWAVE_*`, `FLW_*`, `TEST_PAYMENT_*` | same | kept |
| `ROLE_RATE_LIMITS` | same | kept |
| `BOOKING_ALLOW_ACCEPT_ON_PENDING_PAYMENT` | same | kept |
| `CORS_ORIGINS` | same | kept |
| `ENV`, `DEBUG_INCLUDE_ERROR_DETAILS` | same | kept |
| `SUPER_ADMIN_EMAIL/PASSWORD` | same | kept |
| `AUTH_SESSION_*` (max-age/idle per role) | same | kept |
| `PAYMENT_RECONCILE_POLL_INTERVAL_SECONDS` | — | **removed** (now cron schedule in `vercel.json`) |
| `PAYMENT_RECONCILE_POLL_LIMIT` | same | kept (cron uses it) |
| — | `CRON_SECRET` | **new** (secures cron endpoints) |
| — | `JWT_ISSUER`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_*`, `REFRESH_REUSE_GRACE_SECONDS` | **new** (unified JWT) |

## Managed services

### MongoDB Atlas
- Provision via the **Vercel Marketplace MongoDB Atlas integration** — it injects `MONGODB_URI` into each environment and adds Vercel's dynamic egress to the Atlas IP allow-list (`0.0.0.0/0`).
- Set a low `maxPoolSize` (see `02`). Use a Flex/Dedicated tier for production connection headroom.

### Upstash Redis
- HTTP/REST-based Redis → works from serverless without TCP pooling concerns.
- Used for **rate limiting** and **cache** (and optional cron locks). Provision via Vercel Marketplace; it injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. See `12`.

### Resend
- Verify the sending domain (SPF/DKIM). Set `EMAIL_FROM` to a verified address. Register the webhook URL + `RESEND_WEBHOOK_SECRET`. See `08`.

### Storage (S3)
- Keep the existing S3 bucket + provider abstraction (`STORAGE_BACKEND=s3`). The `local` backend is dev-only on Vercel (the function filesystem is ephemeral/read-only outside `/tmp`).
- **Alternative:** Vercel Blob (`STORAGE_BACKEND=blob`) — add a `blob.ts` provider implementing the same interface. Recommended if you don't want to manage S3 creds.

## Vercel project config

- **Runtime:** Node.js (default). Never Edge (Mongo driver).
- **`maxDuration`:** set on the catch-all (`01`) and a higher value on the dedicated audit-export segment (`10`).
- **Regions:** pick a region close to the Atlas primary to minimize DB latency.
- **`vercel.json`:** holds `crons` (`10`) and any `/v1/* → /api/v1/*` rewrite if preserving legacy client URLs (`07`/`14`).
- **Env management:** use `vercel env` / dashboard; pull locally with `vercel env pull .env.local`. Keep production secrets out of git.

## Local development

- `vercel dev` runs the app locally (note: **cron is not triggered by `vercel dev`** — hit cron routes manually).
- Local Mongo + local Upstash (or a dev Upstash db) + Resend test domain.
- `.env.local` for local secrets; the Zod settings schema validates them on boot.

## Cross-references

- Mongo client + TTL: `02` · Auth env: `03` · Rate-limit/cache: `12` · Cron: `10` · Storage providers: `06`
