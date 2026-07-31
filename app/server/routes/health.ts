import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { getDb } from '@/server/core/mongo'
import { getResend } from '@/server/core/email/resend'
import { DEFAULT_EMAIL_FROM, resolveEmailFromWithSource } from '@/server/core/settings'
import { timingSafeStringEqual } from '@/server/security/hash'
import { fail } from '@/server/core/envelope'
import { translate } from '@/server/core/i18n'
import { formatZodIssues } from '@/server/core/zod-format'

/**
 * Health endpoints. `/health` pings MongoDB and reports which environment
 * variables the running deployment actually has configured.
 * The APScheduler heartbeat check is removed (no scheduler). See docs/migration/07.
 *
 * `/health/email-test` is the one non-public endpoint here — a secret-gated
 * probe that sends a real email and returns the provider's verbatim error.
 */

export const health = createRouter()

/** A var counts as configured only when it is present and non-blank. */
const isSet = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== ''

/**
 * Deployment diagnostics — BOOLEANS ONLY.
 *
 * This endpoint is PUBLIC. Never emit a secret's value, length, or prefix; a
 * `true`/`false` is the entire contract. Only the four genuinely non-secret
 * knobs (`storageBackend`, `nodeEnv`, `env`, `emailFromSource`) report a
 * literal — and `emailFromSource` reports a var NAME, never its value.
 *
 * Read from `process.env` directly rather than `getSettings()`: settings
 * validation throws when a required var is missing, which is precisely the
 * situation this report exists to explain. Defaults mirror server/core/settings.ts.
 */
function envReport() {
  const e = process.env

  // Same precedence rule the send helpers use, applied to the raw env rather
  // than to parsed settings. `source` is a var NAME, never a var value.
  const emailFrom = resolveEmailFromWithSource({
    RESEND_FROM_EMAIL: e.RESEND_FROM_EMAIL,
    EMAIL_FROM: e.EMAIL_FROM,
  })

  return {
    // required trio — the app cannot boot without these
    mongodbUri: isSet(e.MONGODB_URI),
    dbName: isSet(e.DB_NAME),
    jwtSecret: isSet(e.JWT_SECRET),

    // email (Resend). The built-in sender placeholder is as good as unset:
    // Resend rejects an unverified sender domain, so every send fails.
    resendApiKey: isSet(e.RESEND_API_KEY),
    /** True when RESEND_FROM_EMAIL *or* EMAIL_FROM holds a real (non-placeholder) address. */
    emailFromConfigured: emailFrom.value !== DEFAULT_EMAIL_FROM,
    /** Which of the two names is actually in play — the name only, never the address. */
    emailFromSource: emailFrom.source,

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
  emailFromSource: z.enum(['RESEND_FROM_EMAIL', 'EMAIL_FROM', 'default']),
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

/* ------------------------------------------------------------------ *
 * POST /api/health/email-test — secret-gated email diagnostic
 * ------------------------------------------------------------------ */

/**
 * The shared secret this endpoint is gated on: `DIAGNOSTICS_SECRET`, falling
 * back to `CRON_SECRET`. `null` means neither is configured, which DISABLES the
 * endpoint entirely (see the 404 below).
 *
 * Read from `process.env`, not `getSettings()`, for the same reason `envReport`
 * does: settings validation throws on a half-configured deployment, and a
 * half-configured deployment is exactly when this endpoint earns its keep. (It
 * would also reject a `CRON_SECRET` shorter than 16 chars outright.)
 */
function diagnosticsSecret(): string | null {
  for (const name of ['DIAGNOSTICS_SECRET', 'CRON_SECRET'] as const) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

/** Raw provider failure detail — the whole point of this endpoint. */
interface ProviderError {
  name: string
  message: string
  statusCode?: number
}

type EmailTestSend = { ok: true; id: string | null } | { ok: false; error: ProviderError }

/**
 * Belt-and-braces: scrub the API key out of any provider text before it is
 * serialized. Resend does not echo the key back today, but this endpoint hands
 * the caller a RAW provider message, so the one string that must never ride
 * along is removed unconditionally rather than trusted not to show up.
 */
function redactApiKey(text: string): string {
  const key = process.env.RESEND_API_KEY?.trim()
  // A very short key would turn the redaction into a wildcard — skip it.
  if (!key || key.length < 8) return text
  return text.split(key).join('[redacted]')
}

/**
 * Flatten a thrown value, or the Resend SDK's `error` object, into the detail
 * the caller actually needs: provider name, provider message, and `statusCode`
 * when the provider supplied one.
 *
 * Deliberately unsanitized apart from `redactApiKey` — "the domain is not
 * verified" is the sentence we are here to read, and a friendly generic message
 * would destroy precisely the information being chased.
 */
function describeError(err: unknown): ProviderError {
  const src = (err ?? {}) as { name?: unknown; message?: unknown; statusCode?: unknown }
  const name = typeof src.name === 'string' && src.name ? src.name : 'Error'
  const message = typeof src.message === 'string' ? src.message : String(err)
  const out: ProviderError = { name: redactApiKey(name), message: redactApiKey(message) }
  if (typeof src.statusCode === 'number') out.statusCode = src.statusCode
  return out
}

/**
 * Send the probe and report whatever comes back. NOTHING may escape as a throw:
 * the failure IS the diagnostic, so a missing `RESEND_API_KEY` (which makes
 * `getResend()` throw before any request is made) has to arrive as a readable
 * 200 body rather than a 500 whose detail lands only in a runtime log.
 */
async function sendProbe(from: string, to: string): Promise<EmailTestSend> {
  try {
    // No idempotency key on purpose: two probes minutes apart must BOTH really
    // send, otherwise a retry silently replays the first result.
    const { data, error } = await getResend().emails.send({
      from,
      to: [to],
      subject: 'Cleanm email diagnostic',
      text: 'Diagnostic email from the Marcus Cleaning backend. If this arrived, Resend is configured correctly.',
    })
    // The Resend SDK reports API failures in `error` — it does not throw.
    if (error) return { ok: false, error: describeError(error) }
    return { ok: true, id: data?.id ?? null }
  } catch (err) {
    return { ok: false, error: describeError(err) }
  }
}

const emailTestBody = z.object({ to: z.email() })

/**
 * POST /api/health/email-test — send one real email and report the provider's
 * verbatim answer.
 *
 * Exists because a failed admin login OTP surfaces only our controlled
 * `OTP_EMAIL_FAILED` message; Resend's actual complaint ("domain is not
 * verified", "API key is invalid") reaches nothing but the Vercel runtime log,
 * which turns every fix into a guess-and-redeploy cycle.
 *
 * A PLAIN route rather than `.openapi()`: it is gated on a shared secret and
 * stays out of the published spec, exactly like the cron handlers (routes/cron.ts).
 *
 * Gate: `x-diagnostics-secret`, compared in constant time. With neither secret
 * env configured the route answers 404 in the app's own not-found envelope —
 * off by default, and indistinguishable from a route that was never deployed.
 * A missing header and a wrong header get the identical 401, so probing cannot
 * tell them apart.
 *
 * `resolvedFrom` returns the real sender address, which the public `/api/health`
 * deliberately withholds — the gate is what makes that safe, and seeing the
 * exact string Resend was handed is most of the diagnosis. The API KEY is never
 * returned in any form.
 */
health.post('/health/email-test', async (c) => {
  const lang = c.get('locale') ?? 'en'

  const secret = diagnosticsSecret()
  if (!secret) {
    return c.json(fail(c, translate('Not found', lang), 'NOT_FOUND'), 404)
  }

  const provided = c.req.header('x-diagnostics-secret')
  // One response for absent AND wrong — never reveal which one it was.
  if (!provided || !timingSafeStringEqual(provided, secret)) {
    return c.json(fail(c, translate('Unauthorized', lang), 'UNAUTHORIZED'), 401)
  }

  const parsed = emailTestBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(fail(c, translate('Validation error', lang), 'VALIDATION_FAILED', formatZodIssues(parsed.error)), 422)
  }

  // Same helper the send path uses — re-deriving it here would let the
  // diagnostic report a sender the real emails never actually use.
  const from = resolveEmailFromWithSource({
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  })

  return c.json(
    {
      resolvedFrom: from.value,
      emailFromSource: from.source,
      apiKeyPresent: isSet(process.env.RESEND_API_KEY),
      send: await sendProbe(from.value, parsed.data.to),
    },
    200,
  )
})
