import { describe, expect, it, beforeEach } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

beforeEach(() => {
  __resetSettingsCache()
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
})

describe('customer session routes', () => {
  it.each(['/sessions/logout', '/sessions/revoke-others', '/sessions/revoke-all'])(
    'registers POST %s',
    async (path) => {
      const { customers } = await import('@/server/routes/customers')
      const found = customers.routes.some((r) => r.method === 'POST' && r.path === path)
      expect(found).toBe(true)
    },
  )
})
