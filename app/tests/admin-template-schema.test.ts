import { describe, expect, it } from 'vitest'
import {
  FeatureTemplateCreate,
  FeatureTemplateUpdate,
  TEMPLATE_FEATURES,
} from '@/server/schemas/admin-features'

describe('FeatureTemplateCreate', () => {
  it('parses a valid template', () => {
    const parsed = FeatureTemplateCreate.parse({
      feature: 'promo-codes',
      name: 'Launch promo',
      payload: { code: 'X' },
    })
    expect(parsed.feature).toBe('promo-codes')
    expect(parsed.name).toBe('Launch promo')
    expect(parsed.payload).toEqual({ code: 'X' })
  })

  it('rejects an unknown feature', () => {
    expect(() =>
      FeatureTemplateCreate.parse({
        feature: 'not-a-real-feature',
        name: 'X',
        payload: {},
      }),
    ).toThrow()
  })

  it('rejects an empty name', () => {
    expect(() =>
      FeatureTemplateCreate.parse({ feature: 'add-ons', name: '', payload: {} }),
    ).toThrow()
  })

  it('rejects a name over 120 chars', () => {
    expect(() =>
      FeatureTemplateCreate.parse({
        feature: 'add-ons',
        name: 'x'.repeat(121),
        payload: {},
      }),
    ).toThrow()
  })

  it('description is optional', () => {
    expect(() =>
      FeatureTemplateCreate.parse({ feature: 'add-ons', name: 'X', payload: {} }),
    ).not.toThrow()
    const parsed = FeatureTemplateCreate.parse({
      feature: 'add-ons',
      name: 'X',
      description: 'Some notes',
      payload: {},
    })
    expect(parsed.description).toBe('Some notes')
  })

  it('payload accepts an arbitrary object, including nested values and numbers', () => {
    // Deliberate: the payload is a feature's raw field values, and a service
    // definition and a promo code share no shape, so this openness is intentional.
    const parsed = FeatureTemplateCreate.parse({
      feature: 'service-definitions',
      name: 'Deep clean template',
      payload: {
        title: 'Deep Clean',
        basePrice: 120,
        nested: { checklist: ['dust', 'mop'], meta: { weight: 3.5 } },
      },
    })
    expect(parsed.payload).toEqual({
      title: 'Deep Clean',
      basePrice: 120,
      nested: { checklist: ['dust', 'mop'], meta: { weight: 3.5 } },
    })
  })

  it('requires a payload', () => {
    expect(() =>
      FeatureTemplateCreate.parse({ feature: 'add-ons', name: 'X' }),
    ).toThrow()
  })

  it('strips unknown top-level keys instead of storing them', () => {
    const parsed = FeatureTemplateCreate.parse({
      feature: 'add-ons',
      name: 'X',
      payload: {},
      bogus: 'should not survive',
    }) as Record<string, unknown>
    expect(parsed.bogus).toBeUndefined()
  })

  it('exposes the known template feature keys', () => {
    expect(TEMPLATE_FEATURES).toContain('service-definitions')
    expect(TEMPLATE_FEATURES).toContain('promo-codes')
  })
})

describe('FeatureTemplateUpdate', () => {
  it('makes every field optional', () => {
    expect(() => FeatureTemplateUpdate.parse({})).not.toThrow()
    expect(FeatureTemplateUpdate.parse({ name: 'Y' }).name).toBe('Y')
  })
})
