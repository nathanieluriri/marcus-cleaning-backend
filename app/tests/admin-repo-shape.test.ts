import { describe, expect, it } from 'vitest'
import { toAdminOut } from '@/server/repositories/admin-repo'

const baseDoc = {
  _id: '507f1f77bcf86cd799439011',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'hashed',
  accountStatus: 'ACTIVE',
  isSuperAdmin: false,
  permissionList: [],
  preferredLanguage: 'en',
  dateCreated: 1700000000,
  lastUpdated: 1700000000,
}

describe('admin-repo toAdminOut shape', () => {
  it('applies defaults for new fields when absent from the stored doc', () => {
    const out = toAdminOut(baseDoc)
    expect(out.accessPreset).toBeNull()
    expect(out.mustChangePassword).toBe(false)
    expect(out.totpEnabled).toBe(false)
  })

  it('derives totpEnabled=true from a non-null totpEnabledAt', () => {
    const out = toAdminOut({ ...baseDoc, totpEnabledAt: 1700000500 })
    expect(out.totpEnabled).toBe(true)
  })

  it('derives totpEnabled=false when totpEnabledAt is null', () => {
    const out = toAdminOut({ ...baseDoc, totpEnabledAt: null })
    expect(out.totpEnabled).toBe(false)
  })

  it('never leaks secrets or backup code hashes onto AdminOut', () => {
    const out = toAdminOut({
      ...baseDoc,
      totpSecret: 'SECRETBASE32',
      totpPendingSecret: 'PENDINGBASE32',
      backupCodes: ['abc123hash'],
      accessPreset: 'support',
      mustChangePassword: true,
    })
    expect(out).not.toHaveProperty('totpSecret')
    expect(out).not.toHaveProperty('totpPendingSecret')
    expect(out).not.toHaveProperty('backupCodes')
    expect(out.accessPreset).toBe('support')
    expect(out.mustChangePassword).toBe(true)
  })
})
