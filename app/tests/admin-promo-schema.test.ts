import { describe, expect, it } from 'vitest'
import { PromoCodeCreate, PromoCodeUpdate } from '@/server/schemas/admin-features'

describe('PromoCodeCreate', () => {
  it('accepts a canonical percent promo', () => {
    const parsed = PromoCodeCreate.parse({
      code: 'CLEANM10',
      discountType: 'PERCENT',
      discountValue: 10,
      active: true,
    })
    expect(parsed.discountValue).toBe(10)
  })

  it('uppercases the code', () => {
    expect(PromoCodeCreate.parse({ code: 'cleanm10', discountType: 'PERCENT', discountValue: 5 }).code).toBe('CLEANM10')
  })

  it('requires a discount value — a 0%% promo is the bug this fixes', () => {
    expect(() => PromoCodeCreate.parse({ code: 'X', discountType: 'PERCENT' })).toThrow()
  })

  it('rejects a percent discount above 100', () => {
    expect(() => PromoCodeCreate.parse({ code: 'X', discountType: 'PERCENT', discountValue: 150 })).toThrow()
  })

  it('allows a fixed discount above 100', () => {
    expect(PromoCodeCreate.parse({ code: 'X', discountType: 'FIXED', discountValue: 150 }).discountValue).toBe(150)
  })

  it('rejects an expiry before the start', () => {
    expect(() =>
      PromoCodeCreate.parse({ code: 'X', discountType: 'FIXED', discountValue: 5, startsAt: 200, expiresAt: 100 }),
    ).toThrow()
  })

  it('strips legacy keys', () => {
    const parsed = PromoCodeCreate.parse({
      code: 'X',
      discountType: 'PERCENT',
      discountValue: 5,
      discount_value: 99,
      is_active: false,
    }) as Record<string, unknown>
    expect(parsed.discount_value).toBeUndefined()
    expect(parsed.is_active).toBeUndefined()
  })

  it('update schema makes every field optional', () => {
    expect(() => PromoCodeUpdate.parse({})).not.toThrow()
  })
})
