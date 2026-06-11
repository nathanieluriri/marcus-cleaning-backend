import { describe, expect, it } from 'vitest'
import { HomePageModel, buildGreeting } from '@/server/schemas/home'

describe('home schema + greeting', () => {
  it('greets by first name', () => {
    expect(buildGreeting('Ada')).toBe('Welcome back, Ada')
  })

  it('falls back when no name', () => {
    expect(buildGreeting('')).toBe('Welcome back')
    expect(buildGreeting(null)).toBe('Welcome back')
  })

  it('parses a minimal home model with defaults', () => {
    const m = HomePageModel.parse({
      greeting: 'Welcome back, Ada',
      user: { id: 'u1', firstName: 'Ada', lastName: 'L', email: 'a@b.co' },
    })
    expect(m.banners).toEqual([])
    expect(m.serviceCategories).toEqual([])
    expect(m.featuredCleaners).toEqual([])
    expect(m.activeBookings).toEqual([])
    expect(m.recentBookings).toEqual([])
  })
})
