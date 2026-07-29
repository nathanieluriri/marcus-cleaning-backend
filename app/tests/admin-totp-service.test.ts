import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TOTP enrollment + backup codes (spec: Task 3, admin platform plan).
 * `admin-repo` is mocked per the password-reset.test.ts pattern — service
 * level, no Mongo.
 */

interface AdminDocFixture {
  _id: string
  email: string
  totpSecret?: string | null
  totpPendingSecret?: string | null
  totpEnabledAt?: number | null
  backupCodes?: string[]
}

const adminsStore = new Map<string, AdminDocFixture>()

vi.mock('@/server/repositories/admin-repo', () => ({
  findById: vi.fn(async (id: string) => adminsStore.get(id) ?? null),
  updateAdmin: vi.fn(async (id: string, patch: Partial<AdminDocFixture>) => {
    const doc = adminsStore.get(id)
    if (doc) Object.assign(doc, patch)
  }),
  consumeBackupCode: vi.fn(async (id: string, hash: string) => {
    const doc = adminsStore.get(id)
    if (!doc?.backupCodes?.includes(hash)) return false
    doc.backupCodes = doc.backupCodes.filter((h) => h !== hash)
    return true
  }),
}))

import * as totpService from '@/server/services/admin-totp-service'
import { totpCode } from '@/server/security/totp'
import { sha256 } from '@/server/security/hash'

function seedAdmin(overrides: Partial<AdminDocFixture> = {}): AdminDocFixture {
  const doc: AdminDocFixture = { _id: `admin-${adminsStore.size + 1}`, email: 'ada@example.com', ...overrides }
  adminsStore.set(doc._id, doc)
  return doc
}

beforeEach(() => {
  adminsStore.clear()
  vi.clearAllMocks()
})

describe('setup', () => {
  it('stores a pending secret and returns it with an otpauth URI', async () => {
    const admin = seedAdmin()
    const result = await totpService.setup(admin._id)
    expect(result.secret).toMatch(/^[A-Z2-7]+$/)
    expect(result.otpauthUri).toContain(encodeURIComponent(`Marcus Cleaning Admin:${admin.email}`))
    expect(adminsStore.get(admin._id)?.totpPendingSecret).toBe(result.secret)
  })
})

describe('verify', () => {
  it('promotes the pending secret to enabled and returns 8 backup codes', async () => {
    const admin = seedAdmin()
    const { secret } = await totpService.setup(admin._id)
    const code = totpCode(secret)

    const result = await totpService.verify(admin._id, code)
    expect(result.backupCodes).toHaveLength(8)
    expect(new Set(result.backupCodes).size).toBe(8)

    const stored = adminsStore.get(admin._id)!
    expect(stored.totpSecret).toBe(secret)
    expect(stored.totpPendingSecret).toBeNull()
    expect(stored.totpEnabledAt).toEqual(expect.any(Number))
    expect(stored.backupCodes).toHaveLength(8)
    expect(stored.backupCodes).toEqual(result.backupCodes.map(sha256))
  })

  it('rejects a wrong code and leaves the pending secret untouched', async () => {
    const admin = seedAdmin()
    const { secret } = await totpService.setup(admin._id)

    await expect(totpService.verify(admin._id, '000000')).rejects.toMatchObject({
      code: 'TOTP_INVALID',
      httpStatus: 401,
    })

    const stored = adminsStore.get(admin._id)!
    expect(stored.totpPendingSecret).toBe(secret)
    expect(stored.totpEnabledAt ?? null).toBeNull()
  })

  it('rejects when there is no pending setup', async () => {
    const admin = seedAdmin()
    await expect(totpService.verify(admin._id, '123456')).rejects.toMatchObject({
      code: 'TOTP_NOT_PENDING',
      httpStatus: 400,
    })
  })
})

describe('verifyTotpOrBackupCode', () => {
  it('accepts a valid live TOTP code', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const admin = seedAdmin({ totpSecret: secret, totpEnabledAt: 1 })
    const ok = await totpService.verifyTotpOrBackupCode({ ...admin, id: admin._id } as never, totpCode(secret))
    expect(ok).toBe(true)
  })

  it('accepts a valid backup code once, then rejects reuse', async () => {
    const plain = 'ABCDEFGH12'
    const admin = seedAdmin({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabledAt: 1, backupCodes: [sha256(plain)] })

    const first = await totpService.verifyTotpOrBackupCode({ ...admin, id: admin._id } as never, plain)
    expect(first).toBe(true)
    expect(adminsStore.get(admin._id)?.backupCodes).toEqual([])

    const second = await totpService.verifyTotpOrBackupCode({ ...admin, id: admin._id } as never, plain)
    expect(second).toBe(false)
  })

  it('rejects an unknown code', async () => {
    const admin = seedAdmin({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabledAt: 1, backupCodes: [] })
    const ok = await totpService.verifyTotpOrBackupCode({ ...admin, id: admin._id } as never, 'nope')
    expect(ok).toBe(false)
  })
})

describe('disable', () => {
  it('clears all TOTP state given a valid TOTP code', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const admin = seedAdmin({ totpSecret: secret, totpEnabledAt: 1, backupCodes: [sha256('X')] })

    await totpService.disable(admin._id, totpCode(secret))

    const stored = adminsStore.get(admin._id)!
    expect(stored.totpSecret).toBeNull()
    expect(stored.totpPendingSecret).toBeNull()
    expect(stored.totpEnabledAt).toBeNull()
    expect(stored.backupCodes).toEqual([])
  })

  it('clears all TOTP state given a valid backup code', async () => {
    const plain = 'ABCDEFGH12'
    const admin = seedAdmin({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabledAt: 1, backupCodes: [sha256(plain)] })

    await totpService.disable(admin._id, plain)

    expect(adminsStore.get(admin._id)?.totpEnabledAt).toBeNull()
  })

  it('rejects when TOTP is not enabled', async () => {
    const admin = seedAdmin()
    await expect(totpService.disable(admin._id, '123456')).rejects.toMatchObject({
      code: 'TOTP_NOT_ENABLED',
      httpStatus: 400,
    })
  })

  it('rejects a wrong code and leaves TOTP enabled', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const admin = seedAdmin({ totpSecret: secret, totpEnabledAt: 1 })
    await expect(totpService.disable(admin._id, '000000')).rejects.toMatchObject({ code: 'TOTP_INVALID' })
    expect(adminsStore.get(admin._id)?.totpEnabledAt).toBe(1)
  })
})

describe('regenerateBackupCodes', () => {
  it('replaces the backup code set given a valid TOTP code', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const admin = seedAdmin({ totpSecret: secret, totpEnabledAt: 1, backupCodes: [sha256('old')] })

    const result = await totpService.regenerateBackupCodes(admin._id, totpCode(secret))
    expect(result.backupCodes).toHaveLength(8)

    const stored = adminsStore.get(admin._id)!
    expect(stored.backupCodes).toEqual(result.backupCodes.map(sha256))
    expect(stored.backupCodes).not.toContain(sha256('old'))
  })

  it('rejects when TOTP is not enabled', async () => {
    const admin = seedAdmin()
    await expect(totpService.regenerateBackupCodes(admin._id, '123456')).rejects.toMatchObject({
      code: 'TOTP_NOT_ENABLED',
    })
  })
})
