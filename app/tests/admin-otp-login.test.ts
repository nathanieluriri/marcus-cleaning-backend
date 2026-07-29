import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

/**
 * Email OTP second factor on admin login (spec: Task 2, admin platform plan).
 * Repos/session/email are mocked per the password-reset.test.ts pattern —
 * service-level tests, no Mongo.
 */

interface AdminDocFixture {
  _id: string
  firstName: string
  lastName: string
  email: string
  password: string
  accountStatus: string
  isSuperAdmin: boolean
  permissionList: string[]
  preferredLanguage: 'en' | 'fr'
  mustChangePassword?: boolean
  tempPasswordExpiresAt?: number | null
  totpEnabledAt?: number | null
  dateCreated: number
  lastUpdated: number
}

interface ChallengeFixture {
  _id: string
  adminId: string
  codeHash: string | null
  method: 'email' | 'totp'
  attempts: number
  expiresAt: number
  consumedAt?: number | null
  dateCreated: number
}

const adminsStore = new Map<string, AdminDocFixture>()
const challengesStore = new Map<string, ChallengeFixture>()
const sentOtps: { to: string; otp: string }[] = []
let nextChallengeId = 1

vi.mock('@/server/repositories/admin-repo', () => ({
  findByEmail: vi.fn(async (email: string) => [...adminsStore.values()].find((a) => a.email === email) ?? null),
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  insertAdmin: vi.fn(async () => {
    throw new Error('not used in these tests')
  }),
  updateLastAuthAt: vi.fn(async () => {}),
  toAdminOut: vi.fn((doc: AdminDocFixture) => ({
    id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    accountStatus: doc.accountStatus,
    isSuperAdmin: doc.isSuperAdmin,
    permissionList: doc.permissionList,
    preferredLanguage: doc.preferredLanguage,
    accessPreset: null,
    mustChangePassword: doc.mustChangePassword ?? false,
    totpEnabled: doc.totpEnabledAt != null,
    dateCreated: doc.dateCreated,
    lastUpdated: doc.lastUpdated,
  })),
}))

vi.mock('@/server/repositories/admin-otp-repo', () => ({
  insertChallenge: vi.fn(async (doc: Omit<ChallengeFixture, '_id'>) => {
    const _id = String(nextChallengeId++)
    const stored = { ...doc, _id }
    challengesStore.set(_id, stored)
    return stored
  }),
  findById: vi.fn(async (id: string) => challengesStore.get(id) ?? null),
  incrementAttempts: vi.fn(async (id: string) => {
    const c = challengesStore.get(id)
    if (!c) return 0
    c.attempts += 1
    return c.attempts
  }),
  markConsumed: vi.fn(async (id: string, at: number) => {
    const c = challengesStore.get(id)
    if (c) c.consumedAt = at
  }),
}))

vi.mock('@/server/core/email/send', () => ({
  sendOtpEmail: vi.fn(async (args: { to: string; otp: string }) => {
    sentOtps.push(args)
  }),
}))

vi.mock('@/server/services/auth-session-service', () => ({
  issueSession: vi.fn(async () => ({ accessToken: 'access-tok', refreshToken: 'refresh-tok', expiresIn: 900, sessionId: 's-1' })),
}))

import * as adminService from '@/server/services/admin-service'
import * as adminOtpService from '@/server/services/admin-otp-service'
import { assertProductionPosture } from '@/server/core/security-posture'
import { hashPassword } from '@/server/security/hash'
import { issueSession } from '@/server/services/auth-session-service'
import { sendOtpEmail } from '@/server/core/email/send'

const device = { userAgent: 'vitest', ip: '127.0.0.1' }
const PASSWORD = 'correct horse battery staple'
let passwordHash: string

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

function seedAdmin(overrides: Partial<AdminDocFixture> = {}): AdminDocFixture {
  const ts = Math.floor(Date.now() / 1000)
  const doc: AdminDocFixture = {
    _id: overrides._id ?? `admin-${adminsStore.size + 1}`,
    firstName: 'Ada',
    lastName: 'Admin',
    email: overrides.email ?? `admin${adminsStore.size + 1}@example.com`,
    password: passwordHash,
    accountStatus: 'ACTIVE',
    isSuperAdmin: false,
    permissionList: [],
    preferredLanguage: 'en',
    dateCreated: ts,
    lastUpdated: ts,
    ...overrides,
  }
  adminsStore.set(doc._id, doc)
  return doc
}

function seedEnv() {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
}

beforeEach(() => {
  adminsStore.clear()
  challengesStore.clear()
  sentOtps.length = 0
  nextChallengeId = 1
  vi.clearAllMocks()
  delete process.env.ADMIN_OTP_REQUIRED
  delete process.env.OTP_DEV_CODE
  vi.stubEnv('NODE_ENV', 'development')
  __resetSettingsCache()
  seedEnv()
})

describe('admin login — OTP challenge lifecycle', () => {
  it('creates an email challenge on login and verifies with the emailed code', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    __resetSettingsCache()
    const admin = seedAdmin()

    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    expect(loginResult).toMatchObject({ otpRequired: true, method: 'email' })
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    expect(sentOtps).toHaveLength(1)
    expect(sentOtps[0].to).toBe(admin.email)

    const result = await adminOtpService.verifyChallenge({
      challengeId: loginResult.otpChallengeId,
      code: sentOtps[0].otp,
      device,
    })
    expect(result.admin.email).toBe(admin.email)
    expect(result.accessToken).toBe('access-tok')
    expect(issueSession).toHaveBeenCalledTimes(1)
  })

  it('locks after 5 wrong attempts (OTP_LOCKED, 429)', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    __resetSettingsCache()
    const admin = seedAdmin()
    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    for (let i = 0; i < 4; i++) {
      await expect(
        adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: '000000', device }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID', httpStatus: 401 })
    }
    await expect(
      adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: '000000', device }),
    ).rejects.toMatchObject({ code: 'OTP_LOCKED', httpStatus: 429 })
  })

  it('rejects an expired challenge', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    __resetSettingsCache()
    const admin = seedAdmin()
    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    const stored = challengesStore.get(loginResult.otpChallengeId)!
    stored.expiresAt = Math.floor(Date.now() / 1000) - 10

    await expect(
      adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: sentOtps[0].otp, device }),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED', httpStatus: 401 })
  })

  it('rejects reuse of an already-consumed challenge', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    __resetSettingsCache()
    const admin = seedAdmin()
    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    await adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: sentOtps[0].otp, device })

    await expect(
      adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: sentOtps[0].otp, device }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID', httpStatus: 401 })
  })

  it('accepts OTP_DEV_CODE outside production', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    process.env.OTP_DEV_CODE = '999999'
    vi.stubEnv('NODE_ENV', 'development')
    __resetSettingsCache()
    const admin = seedAdmin()
    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    const result = await adminOtpService.verifyChallenge({
      challengeId: loginResult.otpChallengeId,
      code: '999999',
      device,
    })
    expect(result.admin.email).toBe(admin.email)
  })

  it('rejects OTP_DEV_CODE when NODE_ENV=production', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    process.env.OTP_DEV_CODE = '999999'
    vi.stubEnv('NODE_ENV', 'production')
    __resetSettingsCache()
    const admin = seedAdmin()
    const loginResult = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    if (!('otpRequired' in loginResult)) throw new Error('expected challenge')

    await expect(
      adminOtpService.verifyChallenge({ challengeId: loginResult.otpChallengeId, code: '999999', device }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID', httpStatus: 401 })
  })

  it('returns tokens directly when ADMIN_OTP_REQUIRED=false (legacy behaviour)', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'false'
    __resetSettingsCache()
    const admin = seedAdmin()

    const result = await adminService.login({ email: admin.email, password: PASSWORD }, device)
    expect('otpRequired' in result).toBe(false)
    if ('otpRequired' in result) throw new Error('unexpected challenge')
    expect(result.admin.email).toBe(admin.email)
    expect(result.accessToken).toBe('access-tok')
    expect(sentOtps).toHaveLength(0)
  })

  it('rejects login with TEMP_PASSWORD_EXPIRED before creating a challenge', async () => {
    process.env.ADMIN_OTP_REQUIRED = 'true'
    __resetSettingsCache()
    const admin = seedAdmin({
      mustChangePassword: true,
      tempPasswordExpiresAt: Math.floor(Date.now() / 1000) - 60,
    })

    await expect(adminService.login({ email: admin.email, password: PASSWORD }, device)).rejects.toMatchObject({
      code: 'TEMP_PASSWORD_EXPIRED',
      httpStatus: 401,
    })
    expect(sendOtpEmail).not.toHaveBeenCalled()
  })
})

describe('security posture — OTP_DEV_CODE in production', () => {
  it('refuses to boot when NODE_ENV=production and OTP_DEV_CODE is set', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.OTP_DEV_CODE = '123456'
    __resetSettingsCache()
    expect(() => assertProductionPosture()).toThrow(/OTP_DEV_CODE/)
  })

  it('boots fine when OTP_DEV_CODE is unset in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.OTP_DEV_CODE
    __resetSettingsCache()
    expect(() => assertProductionPosture()).not.toThrow()
  })

  it('boots fine with OTP_DEV_CODE set outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.OTP_DEV_CODE = '123456'
    __resetSettingsCache()
    expect(() => assertProductionPosture()).not.toThrow()
  })
})
