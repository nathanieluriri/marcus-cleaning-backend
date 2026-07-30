import { describe, expect, it, beforeEach } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

/** Route-registration check for the Task 3 2FA endpoints, mirroring customer-sessions.test.ts. */

beforeEach(() => {
  __resetSettingsCache()
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
})

describe('admin 2fa routes', () => {
  it.each([
    ['POST', '/2fa/setup'],
    ['POST', '/2fa/verify'],
    ['DELETE', '/2fa'],
    ['POST', '/2fa/backup-codes/regenerate'],
  ])(
    'registers %s %s',
    async (method, path) => {
      const { admins } = await import('@/server/routes/admins')
      const found = admins.routes.some((r) => r.method === method && r.path === path)
      expect(found).toBe(true)
    },
    15000,
  )
})
