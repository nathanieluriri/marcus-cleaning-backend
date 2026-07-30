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

    // firebase auth (native Google/Apple sign-in via the Firebase SDK).
    // Falls back to FCM_PROJECT_ID when both features use the same project.
    FIREBASE_PROJECT_ID: z.string().optional(),

    // google oauth / maps.
    // The iOS/Android client ids are additional accepted audiences for bare
    // Google Sign-In SDK tokens (each platform gets its own client id).
    GOOGLE_IOS_CLIENT_ID: z.string().optional(),
    GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
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
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
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

    // push notifications (Firebase Cloud Messaging HTTP v1; APNs via FCM)
    FCM_PROJECT_ID: z.string().optional(),
    FCM_CLIENT_EMAIL: z.string().optional(),
    /** Service-account private key (PEM). Newlines may be escaped as \n. */
    FCM_PRIVATE_KEY: z.string().optional(),

    /**
     * URI scheme for notification deep links (`<scheme>://bookings/123`).
     * Confirm with the app team before changing — it must match the scheme
     * registered in the Android manifest and iOS Info.plist.
     */
    APP_DEEP_LINK_SCHEME: z.string().default('marcuscleaning'),

    // broadcasts
    /** Recipients processed per batch when fanning out an admin broadcast. */
    BROADCAST_BATCH_SIZE: z.coerce.number().int().positive().max(2000).default(500),

    // payouts
    PAYOUT_CASH_OUT_MIN: z.coerce.number().nonnegative().default(20),
    PAYOUT_CASH_OUT_FEE: z.coerce.number().nonnegative().default(1.5),
    /** Platform commission withheld from a completed job, as a percentage. */
    PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(20),

    // documents
    DOCUMENT_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

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

    // admin 2FA (email OTP mandatory by default; TOTP is the seam Task 3 fills in)
    ADMIN_OTP_REQUIRED: boolFromEnv(true),
    /** Dev-only OTP bypass code. Boot refuses to start if this is set in production. */
    OTP_DEV_CODE: z.string().optional(),
    ADMIN_COOKIE_DOMAIN: z.string().optional(),
    /** Login URL embedded in admin invite emails. Falls back to the first CORS origin, then localhost. */
    ADMIN_LOGIN_URL: z.string().optional(),

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
