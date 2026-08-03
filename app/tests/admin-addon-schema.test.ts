import { describe, expect, it } from 'vitest'
import { AddOnCreate, AddOnUpdate } from '@/server/schemas/admin-features'

describe('AddOnCreate', () => {
  it('accepts a canonical add-on', () => {
    const parsed = AddOnCreate.parse({
      title: 'Inside oven',
      price: 20,
      currency: 'NGN',
      isAvailable: true,
    })
    expect(parsed.price).toBe(20)
  })

  it('accepts an add-on linked to a service', () => {
    expect(AddOnCreate.parse({ title: 'X', price: 5, serviceId: 'svc1' }).serviceId).toBe('svc1')
  })

  it('accepts a global add-on with no service link', () => {
    expect(AddOnCreate.parse({ title: 'X', price: 5 }).serviceId).toBeUndefined()
  })

  it('requires a title', () => {
    expect(() => AddOnCreate.parse({ price: 5 })).toThrow()
  })

  it('requires a price — a priceless add-on is the bug this fixes', () => {
    expect(() => AddOnCreate.parse({ title: 'X' })).toThrow()
  })

  it('rejects a negative price', () => {
    expect(() => AddOnCreate.parse({ title: 'X', price: -1 })).toThrow()
  })

  it('strips the legacy price_minor key so it cannot shadow price', () => {
    const parsed = AddOnCreate.parse({ title: 'X', price: 25, price_minor: 2500 }) as Record<string, unknown>
    expect(parsed.price).toBe(25)
    expect(parsed.price_minor).toBeUndefined()
  })

  it('update schema makes every field optional', () => {
    expect(() => AddOnUpdate.parse({})).not.toThrow()
  })
})
