import { describe, expect, it, beforeEach } from 'vitest'
import { __resetSettingsCache } from '@/server/core/settings'

beforeEach(() => {
  __resetSettingsCache()
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
})

describe('GET /payments/config', () => {
  it('exposes provider list and publishable key, never secrets', async () => {
    const { payments } = await import('@/server/routes/payments')
    const res = await payments.request('/config')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.defaultProvider).toBeDefined()
    expect(body.data.providers).toContain('test')
    expect(JSON.stringify(body)).not.toMatch(/sk_|SECRET/i)
    expect(body.data).toHaveProperty('publishableKey')
  })
})
