import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { __resetSettingsCache } from '@/server/core/settings'

/**
 * httpOnly admin session cookie helpers (Task 4, admin platform plan).
 * Pure unit tests against a bare Hono app — no router/service wiring.
 */

function seedEnv() {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
}

beforeEach(() => {
  delete process.env.ADMIN_COOKIE_DOMAIN
  vi.stubEnv('NODE_ENV', 'development')
  __resetSettingsCache()
  seedEnv()
})

function setCookiesFromResponse(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie()
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

describe('setAdminSessionCookies', () => {
  it('sets admin_access (Path=/api/v1) and admin_refresh (Path=/api/v1/admins/refresh), HttpOnly, SameSite=Lax', async () => {
    __resetSettingsCache()
    const { setAdminSessionCookies } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/set', (c) => {
      setAdminSessionCookies(c, { accessToken: 'ACCESS-TOK', refreshToken: 'REFRESH-TOK', expiresIn: 900 })
      return c.text('ok')
    })
    const res = await app.request('/set')
    const cookies = setCookiesFromResponse(res)
    expect(cookies).toHaveLength(2)

    const access = cookies.find((c) => c.startsWith('admin_access='))!
    expect(access).toBeDefined()
    expect(access).toContain('admin_access=ACCESS-TOK')
    expect(access).toMatch(/Path=\/api\/v1(?!\/admins)/)
    expect(access).toMatch(/HttpOnly/i)
    expect(access).toMatch(/SameSite=Lax/i)
    expect(access).not.toMatch(/Secure/i)

    const refresh = cookies.find((c) => c.startsWith('admin_refresh='))!
    expect(refresh).toBeDefined()
    expect(refresh).toContain('admin_refresh=REFRESH-TOK')
    expect(refresh).toMatch(/Path=\/api\/v1\/admins\/refresh/)
    expect(refresh).toMatch(/HttpOnly/i)
    expect(refresh).toMatch(/SameSite=Lax/i)
  })

  it('sets Secure when NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    __resetSettingsCache()
    const { setAdminSessionCookies } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/set', (c) => {
      setAdminSessionCookies(c, { accessToken: 'A', refreshToken: 'R', expiresIn: 900 })
      return c.text('ok')
    })
    const res = await app.request('/set')
    const cookies = setCookiesFromResponse(res)
    for (const cookie of cookies) expect(cookie).toMatch(/Secure/i)
  })

  it('sets Domain from ADMIN_COOKIE_DOMAIN when configured', async () => {
    process.env.ADMIN_COOKIE_DOMAIN = 'admin.example.com'
    __resetSettingsCache()
    const { setAdminSessionCookies } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/set', (c) => {
      setAdminSessionCookies(c, { accessToken: 'A', refreshToken: 'R', expiresIn: 900 })
      return c.text('ok')
    })
    const res = await app.request('/set')
    const cookies = setCookiesFromResponse(res)
    for (const cookie of cookies) expect(cookie).toMatch(/Domain=admin\.example\.com/i)
  })

  it('omits Domain when ADMIN_COOKIE_DOMAIN is unset', async () => {
    __resetSettingsCache()
    const { setAdminSessionCookies } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/set', (c) => {
      setAdminSessionCookies(c, { accessToken: 'A', refreshToken: 'R', expiresIn: 900 })
      return c.text('ok')
    })
    const res = await app.request('/set')
    const cookies = setCookiesFromResponse(res)
    for (const cookie of cookies) expect(cookie).not.toMatch(/Domain=/i)
  })
})

describe('clearAdminSessionCookies', () => {
  it('clears both cookies with Max-Age=0 and matching Path attributes', async () => {
    __resetSettingsCache()
    const { clearAdminSessionCookies } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/clear', (c) => {
      clearAdminSessionCookies(c)
      return c.text('ok')
    })
    const res = await app.request('/clear')
    const cookies = setCookiesFromResponse(res)
    expect(cookies).toHaveLength(2)

    const access = cookies.find((c) => c.startsWith('admin_access='))!
    expect(access).toMatch(/Max-Age=0/)
    expect(access).toMatch(/Path=\/api\/v1(?!\/admins)/)

    const refresh = cookies.find((c) => c.startsWith('admin_refresh='))!
    expect(refresh).toMatch(/Max-Age=0/)
    expect(refresh).toMatch(/Path=\/api\/v1\/admins\/refresh/)
  })
})

describe('readAdminAccessCookie / readAdminRefreshCookie', () => {
  it('reads back the cookies set on the request', async () => {
    __resetSettingsCache()
    const { readAdminAccessCookie, readAdminRefreshCookie } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/read', (c) => {
      const access = readAdminAccessCookie(c)
      const refresh = readAdminRefreshCookie(c)
      return c.json({ access, refresh })
    })
    const res = await app.request('/read', { headers: { Cookie: 'admin_access=AT1; admin_refresh=RT1' } })
    const body = await res.json()
    expect(body).toEqual({ access: 'AT1', refresh: 'RT1' })
  })

  it('returns undefined when the cookies are absent', async () => {
    __resetSettingsCache()
    const { readAdminAccessCookie, readAdminRefreshCookie } = await import('@/server/security/admin-cookies')
    const app = new Hono()
    app.get('/read', (c) => {
      const access = readAdminAccessCookie(c)
      const refresh = readAdminRefreshCookie(c)
      return c.json({ access: access ?? null, refresh: refresh ?? null })
    })
    const res = await app.request('/read')
    const body = await res.json()
    expect(body).toEqual({ access: null, refresh: null })
  })
})
