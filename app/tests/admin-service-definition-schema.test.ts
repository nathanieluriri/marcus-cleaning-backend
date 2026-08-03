import { describe, expect, it } from 'vitest'
import { ServiceDefinitionCreate, ServiceDefinitionUpdate } from '@/server/schemas/admin-features'

describe('ServiceDefinitionCreate', () => {
  it('accepts a canonical flat-priced service', () => {
    const parsed = ServiceDefinitionCreate.parse({
      title: 'Deep Clean',
      description: 'Top to bottom.',
      basePrice: 120,
      priceUnit: 'FLAT',
      currency: 'NGN',
      isAvailable: true,
    })
    expect(parsed.title).toBe('Deep Clean')
    expect(parsed.basePrice).toBe(120)
  })

  it('accepts a canonical hourly service', () => {
    const parsed = ServiceDefinitionCreate.parse({
      title: 'Hourly Clean',
      hourlyRate: 40,
      minimumHours: 2,
      maximumHours: 8,
      hourIncrement: 0.5,
      priceUnit: 'HOURLY',
      currency: 'NGN',
      isAvailable: true,
    })
    expect(parsed.hourlyRate).toBe(40)
  })

  it('requires a title', () => {
    expect(() => ServiceDefinitionCreate.parse({ basePrice: 10 })).toThrow()
  })

  it('rejects a negative price', () => {
    expect(() => ServiceDefinitionCreate.parse({ title: 'X', basePrice: -1 })).toThrow()
  })

  it('rejects an unknown price unit', () => {
    expect(() => ServiceDefinitionCreate.parse({ title: 'X', priceUnit: 'WEEKLY' })).toThrow()
  })

  it('strips legacy snake_case fields instead of storing them', () => {
    const parsed = ServiceDefinitionCreate.parse({
      title: 'X',
      display_name: 'X',
      is_active: false,
      base_duration_minutes: 120,
    }) as Record<string, unknown>
    expect(parsed.display_name).toBeUndefined()
    expect(parsed.is_active).toBeUndefined()
    expect(parsed.base_duration_minutes).toBeUndefined()
  })

  it('update schema makes every field optional', () => {
    expect(() => ServiceDefinitionUpdate.parse({})).not.toThrow()
    expect(ServiceDefinitionUpdate.parse({ title: 'Y' }).title).toBe('Y')
  })
})
