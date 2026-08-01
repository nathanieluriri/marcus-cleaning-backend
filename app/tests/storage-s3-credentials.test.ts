import { describe, expect, it, afterAll, vi } from 'vitest'

/**
 * Explicit S3 credentials: `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
 *
 * The provider used to construct `new S3Client({...})` with no `credentials`
 * property at all, which leaves the AWS SDK's default provider chain in charge
 * (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, shared config, IAM role). On
 * Vercel the Lambda runtime owns those `AWS_*` names, so an S3-COMPATIBLE
 * backend — Cloudflare R2, MinIO — could never be authenticated. Hence the
 * first-class `S3_*` pair, and the two invariants pinned here:
 *
 *  1. Both set   → `credentials` is handed to the SDK verbatim.
 *  2. Neither set → the property is ABSENT (not `undefined`), so the default
 *     chain still runs for a deployment that authenticates by IAM role.
 *  3. Exactly one set → settings validation fails at boot, rather than silently
 *     degrading to (2) and failing later with an opaque signature error.
 *
 * Every credential value below is an obvious fake.
 */

/**
 * Hoisted so the mock factory hands back the SAME references even after
 * `vi.resetModules()` re-runs it — `constructorArgs` has to survive, or the
 * per-case assertions would read an empty array.
 */
const aws = vi.hoisted(() => {
  const constructorArgs: Array<Record<string, unknown>> = []
  class FakeS3Client {
    send = vi.fn(async () => ({}))
    constructor(public readonly config: Record<string, unknown>) {
      constructorArgs.push(config)
    }
  }
  return { constructorArgs, FakeS3Client }
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: aws.FakeS3Client,
  PutObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.example.test/signed'),
}))

/** Obvious fakes — never a real key, in this repo or anywhere near it. */
const FAKE_ACCESS_KEY_ID = 'fake-test-access-key-id'
const FAKE_SECRET_ACCESS_KEY = 'fake-test-secret-access-key'

const MANAGED_KEYS = [
  'MONGODB_URI',
  'DB_NAME',
  'JWT_SECRET',
  'STORAGE_BACKEND',
  'S3_BUCKET_NAME',
  'S3_REGION',
  'S3_ENDPOINT_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const

const originalEnv: Record<string, string | undefined> = {}
for (const k of MANAGED_KEYS) originalEnv[k] = process.env[k]

/** The rest of the schema still has to parse, so the required vars are seeded too. */
const BASE_ENV: Record<string, string> = {
  MONGODB_URI: 'mongodb://localhost:27017',
  DB_NAME: 'test',
  JWT_SECRET: 'x'.repeat(32),
  STORAGE_BACKEND: 's3',
  S3_BUCKET_NAME: 'test-bucket',
}

/** Replace the managed slice of `process.env` wholesale — cases must not bleed. */
function applyEnv(overrides: Record<string, string | undefined>): void {
  for (const k of MANAGED_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (v !== undefined) process.env[k] = v
  }
}

/**
 * Parse settings from scratch. `vi.resetModules()` matters here as much as in
 * the provider cases: `getSettings()` memoizes, so a stale module would answer
 * with the previous case's env.
 */
async function loadSettings(overrides: Record<string, string | undefined> = {}) {
  applyEnv(overrides)
  vi.resetModules()
  const { getSettings } = await import('@/server/core/settings')
  return getSettings()
}

/**
 * Build the provider's S3 client for one env combination and return the config
 * object it was constructed with. The provider caches its client in module
 * scope, so a fresh module graph is the only way to build a second one.
 */
async function clientConfig(overrides: Record<string, string | undefined> = {}): Promise<Record<string, unknown>> {
  applyEnv(overrides)
  vi.resetModules()
  aws.constructorArgs.length = 0
  const { S3StorageProvider } = await import('@/server/core/storage/s3')
  await new S3StorageProvider().createUploadIntent({ key: 'documents/id.jpg', contentType: 'image/jpeg' })
  expect(aws.constructorArgs).toHaveLength(1)
  return aws.constructorArgs[0]
}

afterAll(() => {
  for (const k of MANAGED_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(originalEnv)) if (v !== undefined) process.env[k] = v
  vi.resetModules()
})

describe('settings — S3 credential pair validation', () => {
  it('accepts both keys together', async () => {
    const settings = await loadSettings({
      S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: FAKE_SECRET_ACCESS_KEY,
    })

    expect(settings.S3_ACCESS_KEY_ID).toBe(FAKE_ACCESS_KEY_ID)
    expect(settings.S3_SECRET_ACCESS_KEY).toBe(FAKE_SECRET_ACCESS_KEY)
  })

  it('accepts neither key — that is the IAM-role / default-chain path', async () => {
    const settings = await loadSettings()

    expect(settings.S3_ACCESS_KEY_ID).toBeUndefined()
    expect(settings.S3_SECRET_ACCESS_KEY).toBeUndefined()
    expect(settings.STORAGE_BACKEND).toBe('s3')
  })

  it('rejects an access key id without its secret', async () => {
    await expect(loadSettings({ S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID })).rejects.toThrow(
      /S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together/,
    )
  })

  it('rejects a secret without its access key id', async () => {
    await expect(loadSettings({ S3_SECRET_ACCESS_KEY: FAKE_SECRET_ACCESS_KEY })).rejects.toThrow(
      /S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together/,
    )
  })

  it('treats a declared-but-empty key as absent, not as half a pair', async () => {
    // Vercel hands an empty string for a var that exists with no value; pairing
    // that with a real key would otherwise look "configured" and fail to sign.
    await expect(loadSettings({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' })).resolves.toBeTruthy()
    await expect(loadSettings({ S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: '' })).rejects.toThrow(
      /S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together/,
    )
  })

  it('leaves the non-s3 backends alone — the rule is scoped to STORAGE_BACKEND=s3', async () => {
    const settings = await loadSettings({
      STORAGE_BACKEND: 'local',
      S3_BUCKET_NAME: undefined,
      S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID,
    })

    expect(settings.STORAGE_BACKEND).toBe('local')
  })

  it('still requires the bucket name for the s3 backend', async () => {
    await expect(loadSettings({ S3_BUCKET_NAME: undefined })).rejects.toThrow(/S3_BUCKET_NAME/)
  })
})

describe('S3 provider — credentials handed to the SDK', () => {
  it('passes the configured pair through to the S3Client', async () => {
    const config = await clientConfig({
      S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: FAKE_SECRET_ACCESS_KEY,
    })

    expect(config.credentials).toEqual({
      accessKeyId: FAKE_ACCESS_KEY_ID,
      secretAccessKey: FAKE_SECRET_ACCESS_KEY,
    })
  })

  it('omits the credentials property entirely when neither key is set', async () => {
    const config = await clientConfig()

    // `in`, not `toBeUndefined()`: an explicit `credentials: undefined` would
    // pass a value-based check while telling the SDK something different from
    // "resolve these yourself".
    expect('credentials' in config).toBe(false)
    expect(Object.keys(config)).not.toContain('credentials')
  })

  it('keeps the region default and adds path-style addressing for an R2-style endpoint', async () => {
    const config = await clientConfig({
      S3_ENDPOINT_URL: 'https://accountid.r2.cloudflarestorage.com',
      S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: FAKE_SECRET_ACCESS_KEY,
    })

    expect(config.region).toBe('us-east-1')
    expect(config.endpoint).toBe('https://accountid.r2.cloudflarestorage.com')
    expect(config.forcePathStyle).toBe(true)
    expect(config.credentials).toEqual({
      accessKeyId: FAKE_ACCESS_KEY_ID,
      secretAccessKey: FAKE_SECRET_ACCESS_KEY,
    })
  })

  it('honours an explicit region and sets no endpoint when none is configured', async () => {
    // R2 wants region 'auto'.
    const config = await clientConfig({ S3_REGION: 'auto' })

    expect(config.region).toBe('auto')
    expect('endpoint' in config).toBe(false)
    expect('forcePathStyle' in config).toBe(false)
  })

  it('constructs the client once and reuses it across operations', async () => {
    applyEnv({ S3_ACCESS_KEY_ID: FAKE_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: FAKE_SECRET_ACCESS_KEY })
    vi.resetModules()
    aws.constructorArgs.length = 0

    const { S3StorageProvider } = await import('@/server/core/storage/s3')
    const provider = new S3StorageProvider()
    await provider.createUploadIntent({ key: 'documents/id.jpg', contentType: 'image/jpeg' })
    await provider.getObjectUrl('documents/id.jpg')
    await provider.deleteObject('documents/id.jpg')

    // Credentials are resolved once per warm instance, not per request.
    expect(aws.constructorArgs).toHaveLength(1)
  })
})
