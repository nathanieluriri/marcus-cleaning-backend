import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

/**
 * GET /api/health — the deployment diagnostics block.
 *
 * The point of `env` is to answer "which vars did I actually set on Vercel?"
 * without ever becoming an exfiltration channel: every key is a boolean apart
 * from three non-secret mode strings. The leak tests below seed sentinel values
 * into the real secrets and assert none of them appear anywhere in the
 * serialized body — that is the invariant that must never regress.
 *
 * Mongo is mocked (no live DB), per the admin-list-route.test.ts pattern.
 */

const pingImpl = vi.fn(async () => ({ ok: 1 }))

vi.mock('@/server/core/mongo', () => ({
  getDb: vi.fn(() => ({ command: pingImpl })),
  getClient: vi.fn(),
}))

import { health } from '@/server/routes/health'
import { DEFAULT_EMAIL_FROM } from '@/server/core/settings'

/** Keys this suite owns — cleared before every test so cases can't bleed. */
const MANAGED_KEYS = [
  'MONGODB_URI',
  'DB_NAME',
  'JWT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD',
  'CORS_ORIGINS',
  'STORAGE_BACKEND',
  'S3_BUCKET_NAME',
  'FIREBASE_PROJECT_ID',
  'FCM_PROJECT_ID',
  'FCM_CLIENT_EMAIL',
  'FCM_PRIVATE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'ADMIN_OTP_REQUIRED',
  'OTP_DEV_CODE',
  'ADMIN_COOKIE_DOMAIN',
  'PUBLIC_APP_URL',
  'ADMIN_LOGIN_URL',
  'ENV',
] as const

const originalEnv: Record<string, string | undefined> = {}
for (const k of MANAGED_KEYS) originalEnv[k] = process.env[k]

/**
 * Distinctive values for every secret-bearing var. Each must be searchable as a
 * substring so the leak assertion is meaningful.
 */
const SECRETS: Record<string, string> = {
  MONGODB_URI: 'mongodb+srv://leakuser:leakpwd-SENTINEL-01@cluster.example.net/marcus',
  DB_NAME: 'marcus-db-SENTINEL-02',
  JWT_SECRET: 'jwt-SENTINEL-03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  RESEND_API_KEY: 're_SENTINEL_04_resendkey',
  EMAIL_FROM: 'Marcus Cleaning <no-reply@sentinel05.example.com>',
  SUPER_ADMIN_EMAIL: 'root-SENTINEL-06@example.com',
  SUPER_ADMIN_PASSWORD: 'super-admin-pwd-SENTINEL-07',
  CORS_ORIGINS: 'https://admin-SENTINEL-08.example.com',
  S3_BUCKET_NAME: 'bucket-SENTINEL-09',
  FIREBASE_PROJECT_ID: 'firebase-SENTINEL-10',
  FCM_PROJECT_ID: 'fcm-SENTINEL-11',
  FCM_CLIENT_EMAIL: 'svc-SENTINEL-12@iam.example.com',
  FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----SENTINEL-13-----END PRIVATE KEY-----',
  UPSTASH_REDIS_REST_URL: 'https://redis-SENTINEL-14.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-token-SENTINEL-15',
  OTP_DEV_CODE: '424242',
  ADMIN_COOKIE_DOMAIN: '.sentinel16.example.com',
  PUBLIC_APP_URL: 'https://app-SENTINEL-17.example.com',
  ADMIN_LOGIN_URL: 'https://admin-SENTINEL-18.example.com/login',
}

function clearManaged() {
  for (const k of MANAGED_KEYS) delete process.env[k]
}

function setAll() {
  for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v
  process.env.STORAGE_BACKEND = 's3'
  process.env.ADMIN_OTP_REQUIRED = 'true'
  process.env.ENV = 'production'
}

interface HealthBody {
  status: string
  timestamp: string
  services: Record<string, { status: string; message: string }>
  env: Record<string, boolean | string>
}

async function getHealth(): Promise<{ status: number; raw: string; body: HealthBody }> {
  const res = await health.request('/health')
  const raw = await res.text()
  return { status: res.status, raw, body: JSON.parse(raw) as HealthBody }
}

beforeEach(() => {
  vi.clearAllMocks()
  pingImpl.mockResolvedValue({ ok: 1 })
  clearManaged()
})

afterAll(() => {
  clearManaged()
  for (const [k, v] of Object.entries(originalEnv)) if (v !== undefined) process.env[k] = v
})

describe('GET /api/health — existing contract preserved', () => {
  it('still returns status, timestamp and services alongside the new env block', async () => {
    const { status, body } = await getHealth()

    expect(status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(typeof body.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    expect(body.services.mongo).toEqual({ status: 'healthy', message: 'MongoDB ping successful' })
    expect(body.env).toBeTypeOf('object')
  })

  it('reports degraded when the Mongo ping fails but still returns the env block', async () => {
    pingImpl.mockRejectedValueOnce(new Error('connection refused'))
    setAll()

    const { status, body } = await getHealth()

    expect(status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.services.mongo.status).toBe('unhealthy')
    expect(body.env.mongodbUri).toBe(true)
  })
})

describe('GET /api/health — env booleans', () => {
  it('reports true for every configured var', async () => {
    setAll()

    const { body } = await getHealth()

    expect(body.env).toMatchObject({
      mongodbUri: true,
      dbName: true,
      jwtSecret: true,
      resendApiKey: true,
      emailFromConfigured: true,
      superAdminEmail: true,
      superAdminPassword: true,
      corsOriginsConfigured: true,
      storageBackend: 's3',
      s3BucketName: true,
      firebaseProjectId: true,
      fcmProjectId: true,
      fcmClientEmail: true,
      fcmPrivateKey: true,
      upstashRedis: true,
      adminOtpRequired: true,
      otpDevCodeSet: true,
      adminCookieDomainSet: true,
      publicAppUrlConfigured: true,
      adminLoginUrlConfigured: true,
      env: 'production',
    })
  })

  it('reports false for every unset var, with the documented defaults', async () => {
    const { body } = await getHealth()

    expect(body.env).toMatchObject({
      mongodbUri: false,
      dbName: false,
      jwtSecret: false,
      resendApiKey: false,
      emailFromConfigured: false,
      superAdminEmail: false,
      superAdminPassword: false,
      corsOriginsConfigured: false,
      s3BucketName: false,
      firebaseProjectId: false,
      fcmProjectId: false,
      fcmClientEmail: false,
      fcmPrivateKey: false,
      upstashRedis: false,
      otpDevCodeSet: false,
      adminCookieDomainSet: false,
      publicAppUrlConfigured: false,
      adminLoginUrlConfigured: false,
      // defaults mirrored from server/core/settings.ts
      storageBackend: 's3',
      adminOtpRequired: true,
      env: 'development',
    })
  })

  it('treats a blank string as unset', async () => {
    process.env.RESEND_API_KEY = '   '
    process.env.S3_BUCKET_NAME = ''

    const { body } = await getHealth()

    expect(body.env.resendApiKey).toBe(false)
    expect(body.env.s3BucketName).toBe(false)
  })

  it('calls the built-in EMAIL_FROM placeholder "not configured" (Resend would reject it)', async () => {
    process.env.EMAIL_FROM = DEFAULT_EMAIL_FROM

    const { body } = await getHealth()

    expect(body.env.emailFromConfigured).toBe(false)
  })

  it('requires BOTH halves of the Upstash pair before reporting it configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = SECRETS.UPSTASH_REDIS_REST_URL
    expect((await getHealth()).body.env.upstashRedis).toBe(false)

    delete process.env.UPSTASH_REDIS_REST_URL
    process.env.UPSTASH_REDIS_REST_TOKEN = SECRETS.UPSTASH_REDIS_REST_TOKEN
    expect((await getHealth()).body.env.upstashRedis).toBe(false)

    process.env.UPSTASH_REDIS_REST_URL = SECRETS.UPSTASH_REDIS_REST_URL
    expect((await getHealth()).body.env.upstashRedis).toBe(true)
  })

  it('reports adminOtpRequired as the effective boolean, not mere presence', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'false'
    expect((await getHealth()).body.env.adminOtpRequired).toBe(false)

    process.env.ADMIN_OTP_REQUIRED = 'TRUE'
    expect((await getHealth()).body.env.adminOtpRequired).toBe(true)
  })

  it('reports the storage backend and runtime mode literally (not secrets)', async () => {
    process.env.STORAGE_BACKEND = 'local'
    process.env.ENV = 'development'
    vi.stubEnv('NODE_ENV', 'production')

    const { body } = await getHealth()

    expect(body.env.storageBackend).toBe('local')
    expect(body.env.env).toBe('development')
    expect(body.env.nodeEnv).toBe('production')

    vi.unstubAllEnvs()
  })
})

describe('GET /api/health — never leaks a secret', () => {
  it('contains no seeded secret value anywhere in the response body', async () => {
    setAll()

    const { raw } = await getHealth()

    for (const [key, value] of Object.entries(SECRETS)) {
      expect(raw, `${key} leaked into /api/health`).not.toContain(value)
    }
    // Nor any recognisable fragment of the highest-value secrets.
    for (const fragment of ['leakpwd', 'SENTINEL', 're_', 'BEGIN PRIVATE KEY', '424242']) {
      expect(raw, `fragment "${fragment}" leaked into /api/health`).not.toContain(fragment)
    }
  })

  it('exposes booleans only, apart from the three non-secret mode strings', async () => {
    setAll()

    const { body } = await getHealth()
    const literalKeys = new Set(['storageBackend', 'nodeEnv', 'env'])

    for (const [key, value] of Object.entries(body.env)) {
      if (literalKeys.has(key)) {
        expect(typeof value, `${key} should be a mode string`).toBe('string')
      } else {
        expect(typeof value, `${key} must be a boolean — no values, lengths or prefixes`).toBe('boolean')
      }
    }
  })

  it('never reports a length or prefix derived from a secret', async () => {
    setAll()

    const { body } = await getHealth()
    // Scoped to `env` — the sibling `timestamp` legitimately carries digits.
    const envRaw = JSON.stringify(body.env)

    // A length leak would surface as a number; `env` carries no numbers at all.
    expect(Object.values(body.env).every((v) => typeof v === 'boolean' || typeof v === 'string')).toBe(true)
    expect(envRaw).not.toContain(SECRETS.JWT_SECRET.slice(0, 8))
    expect(envRaw).not.toContain(SECRETS.RESEND_API_KEY.slice(0, 8))
    expect(envRaw).not.toContain(SECRETS.MONGODB_URI.slice(0, 20))
  })
})
