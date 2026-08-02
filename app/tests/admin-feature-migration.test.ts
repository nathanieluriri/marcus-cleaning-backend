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

  it('does NOT map base_duration_minutes (Finding 3 — needs human decision, not an auto migration)', () => {
    const { patch, flagged, changed } = migrateServiceDefinition({ base_duration_minutes: 120 })
    expect(patch.minimumHours).toBeUndefined()
    expect(flagged).toContain('base_duration_minutes')
    expect(changed).toBe(false)
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

  // Finding 1: add-ons carry the same legacy vocabulary as service definitions.
  it('maps display_name to title', () => {
    expect(migrateAddOn({ display_name: 'Oven Clean' }).patch.title).toBe('Oven Clean')
  })

  it('maps is_active to isAvailable, preserving false so a disabled add-on cannot go live at a real charge', () => {
    const { patch, changed } = migrateAddOn({ price_minor: 2500, is_active: false })
    expect(patch.isAvailable).toBe(false)
    expect(changed).toBe(true)
  })

  it('maps notes to description only when description is absent', () => {
    expect(migrateAddOn({ notes: 'n' }).patch.description).toBe('n')
    expect(migrateAddOn({ notes: 'n', description: 'd' }).patch.description).toBeUndefined()
  })

  // Finding 5: distinguish a real contradiction from a clean/unrecognised doc.
  it('reports a conflict (not a silent skip) when legacy and canonical values disagree', () => {
    const { conflicts, patch } = migrateAddOn({ price_minor: 2500, price: 30 })
    expect(patch.price).toBeUndefined()
    expect(conflicts).toEqual([
      { legacyKey: 'price_minor', canonicalKey: 'price', legacyValue: 2500, canonicalValue: 30 },
    ])
  })

  it('is recognised when it carries a known legacy/canonical key, unrecognised otherwise', () => {
    expect(migrateAddOn({ price_minor: 2500 }).recognised).toBe(true)
    expect(migrateAddOn({ some_unrelated_field: 1 }).recognised).toBe(false)
  })

  // Finding 6: guard numeric conversions against NaN; never write it.
  it('reports an invalid (non-numeric) price_minor instead of writing NaN', () => {
    const { patch, invalid, changed } = migrateAddOn({ price_minor: 'not-a-number' })
    expect(patch.price).toBeUndefined()
    expect(invalid).toContain('price_minor')
    expect(changed).toBe(false)
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

  // Finding 4: normalize code (trim + uppercase) to match PromoCodeCreate, but
  // only when it actually differs, so an already-normalized code stays idempotent.
  it('normalizes a legacy code by trimming and uppercasing', () => {
    expect(migratePromoCode({ code: ' save10 ' }).patch.code).toBe('SAVE10')
  })

  it('does not report a change when code is already normalized', () => {
    expect(migratePromoCode({ code: 'SAVE10' }).changed).toBe(false)
  })

  // Finding 6: guard numeric conversions against NaN.
  it('reports an invalid discount_value instead of writing NaN', () => {
    const { patch, invalid } = migratePromoCode({ discount_value: 'lots' })
    expect(patch.discountValue).toBeUndefined()
    expect(invalid).toContain('discount_value')
  })
})
