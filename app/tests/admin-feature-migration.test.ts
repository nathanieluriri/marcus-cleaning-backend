import { describe, expect, it } from 'vitest'
import {
  buildUpdateFilter,
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

  // Round-2 finding: a conflicting field must not silently swallow a sibling
  // clean-field migration on the SAME document. Conservative behaviour (do
  // not write the document at all) is correct, but the withholding of the
  // clean `title` migration must be visible via `withheldKeys`.
  it('reports a withheld clean-field migration when a sibling field on the same document conflicts', () => {
    const { patch, conflicts, withheldKeys, changed } = migrateAddOn({
      price_minor: 2500,
      price: 30,
      display_name: 'Oven Clean',
    })
    // The clean field is still computed...
    expect(patch.title).toBe('Oven Clean')
    expect(patch.price).toBeUndefined()
    // ...but the document must not be treated as write-safe: it has a conflict,
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].legacyKey).toBe('price_minor')
    // ...and the runner must be told, by name, which clean migration it is withholding.
    expect(withheldKeys).toEqual(['title'])
    expect(changed).toBe(true)
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

  // Finding 1: `Number(null)`, `Number('')`, `Number('  ')`, `Number([])`,
  // and `Number(false)` all evaluate to 0 in JS. Each of these malformed
  // legacy values must be reported as invalid, never silently written as a
  // canonical price of 0 (which would look like a genuinely free add-on and
  // hide the exact bug this migration exists to fix).
  it.each([
    ['null', null],
    ['empty string', ''],
    ['whitespace-only string', '  '],
    ['an array', []],
    ['false', false],
  ])('reports price_minor: %s as invalid, not as a canonical price of 0', (_label, value) => {
    const { patch, invalid, changed } = migrateAddOn({ price_minor: value })
    expect(patch.price).toBeUndefined()
    expect(invalid).toContain('price_minor')
    expect(changed).toBe(false)
  })

  // Chosen semantic: a legacy `price_minor: 0` means "genuinely free" and is
  // a legitimate value, distinct from the malformed inputs above — it must
  // still convert and write normally.
  it('still migrates a genuine price_minor of 0 (a real free add-on) to price: 0', () => {
    const { patch, invalid, changed } = migrateAddOn({ price_minor: 0 })
    expect(patch.price).toBe(0)
    expect(invalid).not.toContain('price_minor')
    expect(changed).toBe(true)
  })

  // Finding 5: `name` / `active` are a second legacy spelling that
  // `catalog-service.ts` already falls back to when reading — map them so
  // documents using this spelling stop showing up as "unrecognised".
  it('maps name to title and active to isAvailable', () => {
    const { patch, recognised } = migrateAddOn({ name: 'Window Clean', active: true })
    expect(patch.title).toBe('Window Clean')
    expect(patch.isAvailable).toBe(true)
    expect(recognised).toBe(true)
  })
})

describe('buildUpdateFilter', () => {
  // Finding 2: the write must re-check its own precondition, because the
  // read (cursor) and the write happen far apart in time during a long scan
  // of a live collection.
  it('adds an absent-field guard for each new canonical key in the patch', () => {
    const filter = buildUpdateFilter('doc-1', { title: 'X', isAvailable: true })
    expect(filter).toEqual({
      _id: 'doc-1',
      title: { $exists: false },
      isAvailable: { $exists: false },
    })
  })

  // `code` is normalised in place (same key holds the legacy and canonical
  // value), so it is never "absent" and must not get a guard — guarding it
  // would make the filter unsatisfiable and the normalisation would never write.
  it('does not guard the code key, since it is normalised in place rather than copied from a distinct legacy key', () => {
    const filter = buildUpdateFilter('doc-2', { code: 'SAVE10', discountType: 'PERCENT' })
    expect(filter).toEqual({
      _id: 'doc-2',
      discountType: { $exists: false },
    })
  })

  it('produces just the _id filter when the patch is empty', () => {
    expect(buildUpdateFilter('doc-3', {})).toEqual({ _id: 'doc-3' })
  })
})

describe('migratePromoCode', () => {
  it('maps discount_value to discountValue', () => {
    expect(migratePromoCode({ discount_value: 10 }).patch.discountValue).toBe(10)
  })

  // Finding 2: `discountType` is a strict enum (`'PERCENT' | 'FIXED'`) — a
  // naive uppercase of the console's old `percentage` placeholder produces
  // `"PERCENTAGE"`, which the schema rejects and makes the promo uneditable.
  // Legacy spellings are mapped explicitly instead.
  it('maps known percent spellings to PERCENT', () => {
    expect(migratePromoCode({ discount_type: 'percent' }).patch.discountType).toBe('PERCENT')
    expect(migratePromoCode({ discount_type: 'percentage' }).patch.discountType).toBe('PERCENT')
    expect(migratePromoCode({ discount_type: '%' }).patch.discountType).toBe('PERCENT')
  })

  it('maps known fixed spellings to FIXED', () => {
    expect(migratePromoCode({ discount_type: 'fixed' }).patch.discountType).toBe('FIXED')
    expect(migratePromoCode({ discount_type: 'amount' }).patch.discountType).toBe('FIXED')
    expect(migratePromoCode({ discount_type: 'flat' }).patch.discountType).toBe('FIXED')
  })

  it('does not map an unrecognised discount_type, and flags it for human review', () => {
    const { patch, flagged, changed } = migratePromoCode({ discount_type: 'buy_one_get_one' })
    expect(patch.discountType).toBeUndefined()
    expect(flagged).toContain('discount_type')
    expect(changed).toBe(false)
  })

  it('flags an unrecognised legacy discount_type for human review even when a canonical value already exists, without reporting a conflict', () => {
    // The legacy value is unrecognised, so it is never compared against the
    // canonical value at all (there is nothing to compare — normalization
    // failed first) and therefore cannot produce a `conflicts` entry. It is
    // still surfaced via `flagged` so a human can decide whether the legacy
    // spelling needs a new mapping.
    const { patch, conflicts, flagged } = migratePromoCode({
      discount_type: 'buy_one_get_one',
      discountType: 'PERCENT',
    })
    expect(patch.discountType).toBeUndefined()
    expect(conflicts).toEqual([])
    expect(flagged).toContain('discount_type')
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
