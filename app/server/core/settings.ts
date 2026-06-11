import { z } from 'zod'

/**
 * Environment / settings — Zod-validated, lazily parsed and memoized.
 *
 * Ported from the Python `core/settings.py`. Parsing is lazy (not at import
 * time) so type-checking, builds, and tests don't require a full `.env`.
 * The first call that needs settings triggers validation and fails fast on
 * missing/invalid required vars.
 *
 * See: ../../../docs/migration/11-infra-and-env.md
 */

/** Parse a boolean from an env string ("true"/"false"); `z.coerce.boolean` is unsafe here. */
const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.toLowerCase() === 'true'))

const EnvSchema = z
  .object({
    // runtime
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ENV: z.enum(['development', 'production']).default('development'),
    DEBUG_INCLUDE_ERROR_DETAILS: boolFromEnv(false),

    // database
    MONGODB_URI: z.string().min(1),
    DB_NAME: z.string().min(1),

    // auth (unified JWT — replaces Auth0 + local secrets)
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('marcus-backend'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_WEB_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
    REFRESH_IDLE_MOBILE_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 60),
    REFRESH_ABSOLUTE_MOBILE_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 180),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(20),
    SESSION_SECRET_KEY: z.string().min(16).optional(),

    // google oauth / maps
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    // email (Resend)
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    EMAIL_FROM: z.string().default('Marcus Cleaning <no-reply@example.com>'),

    // payments
    PAYMENT_DEFAULT_PROVIDER: z.enum(['flutterwave', 'stripe', 'test']).default('test'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    FLUTTERWAVE_SECRET_KEY: z.string().optional(),
    FLW_WEBHOOK_SECRET_HASH: z.string().optional(),
    TEST_PAYMENT_BASE_URL: z.string().optional(),
    TEST_PAYMENT_WEBHOOK_SECRET_HASH: z.string().optional(),
    SUCCESS_PAGE_URL: z.string().optional(),
    ERROR_PAGE_URL: z.string().optional(),

    // storage
    STORAGE_BACKEND: z.enum(['local', 's3', 'blob']).default('s3'),
    S3_BUCKET_NAME: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT_URL: z.string().optional(),
    STORAGE_LOCAL_ROOT: z.string().default('uploads'),

    // cache / rate-limit (Upstash)
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    ROLE_RATE_LIMITS: z.string().optional(),

    // cron
    CRON_SECRET: z.string().min(16).optional(),

    // misc
    CORS_ORIGINS: z.string().optional(),
    // Trusted base URL for user-facing links (e.g. password-reset). NEVER derive
    // this from the request Host header — that enables reset-link poisoning.
    PUBLIC_APP_URL: z.string().default('https://marcus-cleaning-backend.vercel.app'),
    BOOKING_ALLOW_ACCEPT_ON_PENDING_PAYMENT: boolFromEnv(false),
    PAYMENT_RECONCILE_POLL_LIMIT: z.coerce.number().int().positive().default(50),
    SUPER_ADMIN_EMAIL: z.string().optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),

    // per-role session policy (carried over from FastAPI)
    AUTH_SESSION_MAX_AGE_ADMIN_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 12),
    AUTH_SESSION_MAX_AGE_CLEANER_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
    AUTH_SESSION_MAX_AGE_CUSTOMER_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
    AUTH_SESSION_IDLE_TIMEOUT_ADMIN_SECONDS: z.coerce.number().int().positive().default(60 * 30),
    AUTH_SESSION_IDLE_TIMEOUT_CLEANER_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24),
    AUTH_SESSION_IDLE_TIMEOUT_CUSTOMER_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24),
  })
  .superRefine((v, ctx) => {
    if (v.PAYMENT_DEFAULT_PROVIDER === 'stripe' && (!v.STRIPE_SECRET_KEY || !v.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({ code: 'custom', message: 'Stripe provider requires STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET' })
    }
    if (v.PAYMENT_DEFAULT_PROVIDER === 'flutterwave' && (!v.FLUTTERWAVE_SECRET_KEY || !v.FLW_WEBHOOK_SECRET_HASH)) {
      ctx.addIssue({ code: 'custom', message: 'Flutterwave provider requires FLUTTERWAVE_SECRET_KEY + FLW_WEBHOOK_SECRET_HASH' })
    }
    if (v.STORAGE_BACKEND === 's3' && !v.S3_BUCKET_NAME) {
      ctx.addIssue({ code: 'custom', message: 'S3 storage backend requires S3_BUCKET_NAME' })
    }
  })

export type Settings = z.infer<typeof EnvSchema>

let cached: Settings | null = null

export function getSettings(): Settings {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment configuration: ${issues}`)
  }
  cached = parsed.data
  return cached
}

export function isProduction(): boolean {
  return getSettings().ENV === 'production'
}

/** Test helper — reset the memoized settings (used by Vitest). */
export function __resetSettingsCache(): void {
  cached = null
}
