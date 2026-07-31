import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { getDb } from '@/server/core/mongo'
import { DEFAULT_EMAIL_FROM } from '@/server/core/settings'

/**
 * Health endpoints. `/health` pings MongoDB and reports which environment
 * variables the running deployment actually has configured.
 * The APScheduler heartbeat check is removed (no scheduler). See docs/migration/07.
 */

export const health = createRouter()

/** A var counts as configured only when it is present and non-blank. */
const isSet = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== ''

/**
 * Deployment diagnostics — BOOLEANS ONLY.
 *
 * This endpoint is PUBLIC. Never emit a secret's value, length, or prefix; a
 * `true`/`false` is the entire contract. Only the three genuinely non-secret
 * knobs (`storageBackend`, `nodeEnv`, `env`) report a literal.
 *
 * Read from `process.env` directly rather than `getSettings()`: settings
 * validation throws when a required var is missing, which is precisely the
 * situation this report exists to explain. Defaults mirror server/core/settings.ts.
 */
function envReport() {
  const e = process.env
  return {
    // required trio — the app cannot boot without these
    mongodbUri: isSet(e.MONGODB_URI),
    dbName: isSet(e.DB_NAME),
    jwtSecret: isSet(e.JWT_SECRET),

    // email (Resend). The built-in EMAIL_FROM placeholder is as good as unset:
    // Resend rejects an unverified sender domain, so every send fails.
    resendApiKey: isSet(e.RESEND_API_KEY),
    emailFromConfigured: isSet(e.EMAIL_FROM) && e.EMAIL_FROM !== DEFAULT_EMAIL_FROM,

    // bootstrap admin
    superAdminEmail: isSet(e.SUPER_ADMIN_EMAIL),
    superAdminPassword: isSet(e.SUPER_ADMIN_PASSWORD),

    // false means CORS is falling back to http://localhost:3000
    corsOriginsConfigured: isSet(e.CORS_ORIGINS),

    // storage — the backend name is a mode, not a secret
    storageBackend: e.STORAGE_BACKEND ?? 's3',
    s3BucketName: isSet(e.S3_BUCKET_NAME),

    // firebase auth + push
    firebaseProjectId: isSet(e.FIREBASE_PROJECT_ID),
    fcmProjectId: isSet(e.FCM_PROJECT_ID),
    fcmClientEmail: isSet(e.FCM_CLIENT_EMAIL),
    fcmPrivateKey: isSet(e.FCM_PRIVATE_KEY),

    // rate-limit / cache — only usable when BOTH halves are present
    upstashRedis: isSet(e.UPSTASH_REDIS_REST_URL) && isSet(e.UPSTASH_REDIS_REST_TOKEN),

    // admin 2FA posture
    adminOtpRequired: e.ADMIN_OTP_REQUIRED === undefined ? true : e.ADMIN_OTP_REQUIRED.toLowerCase() === 'true',
    /** MUST be false in production — it is a 2FA bypass (boot refuses it there). */
    otpDevCodeSet: isSet(e.OTP_DEV_CODE),
    /** Expected false unless admin cookies are deliberately shared across subdomains. */
    adminCookieDomainSet: isSet(e.ADMIN_COOKIE_DOMAIN),

    // user-facing link bases (false = falling back to the built-in default)
    publicAppUrlConfigured: isSet(e.PUBLIC_APP_URL),
    adminLoginUrlConfigured: isSet(e.ADMIN_LOGIN_URL),

    // runtime mode — not secret
    nodeEnv: e.NODE_ENV ?? 'development',
    env: e.ENV ?? 'development',
  }
}

const envSchema = z.object({
  mongodbUri: z.boolean(),
  dbName: z.boolean(),
  jwtSecret: z.boolean(),
  resendApiKey: z.boolean(),
  emailFromConfigured: z.boolean(),
  superAdminEmail: z.boolean(),
  superAdminPassword: z.boolean(),
  corsOriginsConfigured: z.boolean(),
  storageBackend: z.string(),
  s3BucketName: z.boolean(),
  firebaseProjectId: z.boolean(),
  fcmProjectId: z.boolean(),
  fcmClientEmail: z.boolean(),
  fcmPrivateKey: z.boolean(),
  upstashRedis: z.boolean(),
  adminOtpRequired: z.boolean(),
  otpDevCodeSet: z.boolean(),
  adminCookieDomainSet: z.boolean(),
  publicAppUrlConfigured: z.boolean(),
  adminLoginUrlConfigured: z.boolean(),
  nodeEnv: z.string(),
  env: z.string(),
})

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Health check',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
            services: z.record(z.string(), z.object({ status: z.string(), message: z.string() })),
            env: envSchema,
          }),
        },
      },
    },
  },
})

health.openapi(healthRoute, async (c) => {
  const services: Record<string, { status: string; message: string }> = {}
  let status = 'healthy'
  try {
    await getDb().command({ ping: 1 })
    services.mongo = { status: 'healthy', message: 'MongoDB ping successful' }
  } catch (err) {
    status = 'degraded'
    services.mongo = { status: 'unhealthy', message: err instanceof Error ? err.message : 'ping failed' }
  }
  return c.json({ status, timestamp: new Date().toISOString(), services, env: envReport() }, 200)
})
