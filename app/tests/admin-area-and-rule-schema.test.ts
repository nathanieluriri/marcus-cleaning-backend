import { describe, expect, it } from 'vitest'
import {
  PricingRuleCreate,
  ServiceAreaCreate,
  ServiceAreaUpdate,
} from '@/server/schemas/admin-features'

describe('ServiceAreaCreate', () => {
  it('accepts a canonical area', () => {
    const parsed = ServiceAreaCreate.parse({
      zone_code: 'LA-VI',
      display_name: 'Victoria Island',
      zip_codes: ['101001', '101002'],
      is_active: true,
    })
    expect(parsed.zip_codes).toHaveLength(2)
  })

  it('requires a zone code', () => {
    expect(() => ServiceAreaCreate.parse({ display_name: 'X' })).toThrow()
  })

  it('rejects boundary_geojson that is not valid JSON', () => {
    expect(() =>
      ServiceAreaCreate.parse({ zone_code: 'A', display_name: 'B', boundary_geojson: '{not json' }),
    ).toThrow()
  })
})

describe('ServiceAreaUpdate', () => {
  it('rejects boundary_geojson that is not valid JSON on partial updates', () => {
    expect(() =>
      ServiceAreaUpdate.parse({ boundary_geojson: '{not json' }),
    ).toThrow()
  })
})

describe('PricingRuleCreate', () => {
  it('accepts a canonical rule', () => {
    const parsed = PricingRuleCreate.parse({
      rule_name: 'Weekend Surge',
      rule_type: 'time_window',
      multiplier: 1.2,
      priority: 10,
      start_hour: 18,
      end_hour: 22,
      is_active: true,
    })
    expect(parsed.multiplier).toBe(1.2)
  })

  it('rejects an hour outside 0-23', () => {
    expect(() =>
      PricingRuleCreate.parse({ rule_name: 'X', rule_type: 'time_window', multiplier: 1, priority: 1, start_hour: 24 }),
    ).toThrow()
  })

  it('rejects a non-positive multiplier', () => {
    expect(() =>
      PricingRuleCreate.parse({ rule_name: 'X', rule_type: 'time_window', multiplier: 0, priority: 1 }),
    ).toThrow()
  })

  it('rejects an unknown rule type', () => {
    expect(() =>
      PricingRuleCreate.parse({ rule_name: 'X', rule_type: 'made_up', multiplier: 1, priority: 1 }),
    ).toThrow()
  })
})
