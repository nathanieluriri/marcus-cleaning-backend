import { describe, expect, it } from 'vitest'
import {
  migrateAddOn,
  migratePromoCode,
  migrateServiceDefinition,
} from '@/server/services/admin-feature-migration'

describe('migrateServiceDefinition', () => {
  it('maps display_name to title', () => {
    const { changed, patch } = migrateServiceDefinition({ display_name: 'Deep Clean' })
    expect(changed).toBe(true)
    expect(patch.title).toBe('Deep Clean')
  })

  it('maps is_active to isAvailable, preserving false', () => {
    expect(migrateServiceDefinition({ is_active: false }).patch.isAvailable).toBe(false)
  })

  it('converts base_duration_minutes to minimumHours', () => {
    expect(migrateServiceDefinition({ base_duration_minutes: 120 }).patch.minimumHours).toBe(2)
  })

  it('maps notes to description only when description is absent', () => {
    expect(migrateServiceDefinition({ notes: 'n' }).patch.description).toBe('n')
    expect(migrateServiceDefinition({ notes: 'n', description: 'd' }).patch.description).toBeUndefined()
  })

  it('never clobbers an existing canonical title', () => {
    const { patch } = migrateServiceDefinition({ display_name: 'Legacy', title: 'Canonical' })
    expect(patch.title).toBeUndefined()
  })

  it('is idempotent — an already-migrated doc reports no change', () => {
    expect(migrateServiceDefinition({ title: 'X', isAvailable: true }).changed).toBe(false)
  })
})

describe('migrateAddOn', () => {
  it('converts price_minor to major-unit price', () => {
    expect(migrateAddOn({ price_minor: 2500 }).patch.price).toBe(25)
  })

  it('handles a price_minor that is not a whole number of major units', () => {
    expect(migrateAddOn({ price_minor: 2550 }).patch.price).toBe(25.5)
  })

  it('never clobbers an existing canonical price', () => {
    expect(migrateAddOn({ price_minor: 2500, price: 30 }).patch.price).toBeUndefined()
  })

  it('is idempotent', () => {
    expect(migrateAddOn({ title: 'X', price: 25 }).changed).toBe(false)
  })
})

describe('migratePromoCode', () => {
  it('maps discount_value to discountValue', () => {
    expect(migratePromoCode({ discount_value: 10 }).patch.discountValue).toBe(10)
  })

  it('uppercases discount_type', () => {
    expect(migratePromoCode({ discount_type: 'percent' }).patch.discountType).toBe('PERCENT')
  })

  it('maps is_active to active, preserving false', () => {
    expect(migratePromoCode({ is_active: false }).patch.active).toBe(false)
  })

  it('maps the epoch window fields', () => {
    const { patch } = migratePromoCode({ valid_from_epoch: 100, valid_to_epoch: 200 })
    expect(patch.startsAt).toBe(100)
    expect(patch.expiresAt).toBe(200)
  })

  it('is idempotent', () => {
    expect(migratePromoCode({ code: 'X', discountType: 'PERCENT', discountValue: 5 }).changed).toBe(false)
  })
})
