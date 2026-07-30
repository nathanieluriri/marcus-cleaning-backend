import { describe, expect, it, vi } from 'vitest'

const HOURLY_SERVICE = {
  _id: 'hourly-svc',
  hourlyRate: 40,
  minimumHours: 2,
  hourIncrement: 0.5,
  maximumHours: 8,
  currency: 'USD',
}
const FLAT_SERVICE = {
  _id: 'flat-svc',
  basePrice: 100,
  currency: 'USD',
}

const ADDON_CATALOG_DOCS: Record<string, { price: number }> = {
  addon1: { price: 15 },
}

vi.mock('@/server/repositories/admin-features/_generic-repo', () => ({
  getDocById: vi.fn(async (collection: string, id: string) => {
    if (collection === 'service_definitions') {
      if (id === 'hourly-svc') return HOURLY_SERVICE
      if (id === 'flat-svc') return FLAT_SERVICE
      return null
    }
    if (collection === 'addon_catalog') return ADDON_CATALOG_DOCS[id] ?? null
    return null
  }),
}))

import { computeQuote, quoteForBooking } from '@/server/services/pricing-service'
import { AppError } from '@/server/core/errors'

describe('computeQuote hourly duration pricing', () => {
  it('hours=3 on hourly service -> base 120', async () => {
    const quote = await computeQuote('hourly-svc', [], 3)
    expect(quote.base).toBe(120)
    expect(quote.total).toBe(120)
  })

  it('hours below minimum -> 422 with details', async () => {
    await expect(computeQuote('hourly-svc', [], 1)).rejects.toMatchObject({
      httpStatus: 422,
      code: 'VALIDATION_FAILED',
      details: { minimumHours: 2, maximumHours: 8, hourIncrement: 0.5 },
    })
  })

  it('hours off-increment (2.7) -> 422', async () => {
    await expect(computeQuote('hourly-svc', [], 2.7)).rejects.toBeInstanceOf(AppError)
  })

  it('hours above maximum -> 422', async () => {
    await expect(computeQuote('hourly-svc', [], 9)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('hours provided on a flat (non-hourly) service -> 422', async () => {
    await expect(computeQuote('flat-svc', [], 2)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('no hours on hourly service falls back to basePrice ?? price (0 here, today\'s behavior)', async () => {
    const quote = await computeQuote('hourly-svc', [])
    expect(quote.base).toBe(0)
  })

  it('no hours on flat service -> 100', async () => {
    const quote = await computeQuote('flat-svc', [])
    expect(quote.base).toBe(100)
  })

  it('addons are added on top in all cases', async () => {
    const quote = await computeQuote('hourly-svc', [{ addonId: 'addon1', quantity: 2 }], 3)
    expect(quote.base).toBe(120)
    expect(quote.addons).toBe(30)
    expect(quote.total).toBe(150)
  })

  it('quoteForBooking threads stored booking.hours through to pricing', async () => {
    const quote = await quoteForBooking({ serviceId: 'hourly-svc', addons: [], hours: 4 })
    expect(quote.base).toBe(160)
  })

  it('quoteForBooking with no hours falls back to flat pricing', async () => {
    const quote = await quoteForBooking({ serviceId: 'flat-svc', addons: [] })
    expect(quote.base).toBe(100)
  })
})
