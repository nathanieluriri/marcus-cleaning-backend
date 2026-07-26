import { describe, expect, it } from 'vitest'
import { nextScheduledPayout, periodWindow } from '@/server/services/earnings-service'
import { splitPayout } from '@/server/services/job-session-service'
import { computeDiscount } from '@/server/schemas/promotion'
import { durationOf } from '@/server/schemas/job-session'

// 2025-06-15T14:26:40Z — a Sunday.
const NOW = 1_750_000_000

describe('periodWindow', () => {
  it('returns 7 day buckets for a week', () => {
    const { buckets } = periodWindow('week', NOW)
    expect(buckets).toHaveLength(7)
    expect(buckets[6]).toBe(Math.floor(NOW / 86400) * 86400)
  })

  it('returns 30 day buckets for a month', () => {
    expect(periodWindow('month', NOW).buckets).toHaveLength(30)
  })

  it('returns 12 month buckets for a year', () => {
    const { buckets } = periodWindow('year', NOW)
    expect(buckets).toHaveLength(12)
    // Buckets must be strictly ascending month starts.
    for (let i = 1; i < buckets.length; i++) expect(buckets[i]).toBeGreaterThan(buckets[i - 1])
  })
})

describe('nextScheduledPayout', () => {
  it('lands on a Friday, in the future', () => {
    const next = nextScheduledPayout(NOW)
    expect(next).toBeGreaterThan(NOW)
    expect(new Date(next * 1000).getUTCDay()).toBe(5)
  })

  it('skips to next week when today is already Friday', () => {
    const friday = nextScheduledPayout(NOW)
    const next = nextScheduledPayout(friday)
    expect(next).toBe(friday + 7 * 86400)
  })
})

describe('splitPayout', () => {
  it('withholds the commission percentage', () => {
    expect(splitPayout(100, 20)).toEqual({ earnings: 80, commission: 20 })
  })

  it('rounds to cents', () => {
    const { earnings, commission } = splitPayout(65.55, 20)
    expect(commission).toBe(13.11)
    expect(earnings).toBe(52.44)
  })

  it('pays everything when commission is zero', () => {
    expect(splitPayout(50, 0)).toEqual({ earnings: 50, commission: 0 })
  })
})

describe('computeDiscount', () => {
  it('applies a percentage', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 20, maximumDiscount: null }, 65)).toBe(13)
  })

  it('applies a fixed amount', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 15, maximumDiscount: null }, 65)).toBe(15)
  })

  it('respects the maximum discount cap', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 50, maximumDiscount: 10 }, 100)).toBe(10)
  })

  it('never exceeds the subtotal', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 100, maximumDiscount: null }, 40)).toBe(40)
  })

  it('never goes negative', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: -10, maximumDiscount: null }, 40)).toBe(0)
  })
})

describe('durationOf', () => {
  it('measures against now while running', () => {
    expect(durationOf({ startedAt: NOW - 600, completedAt: null }, NOW)).toBe(600)
  })

  it('freezes once completed', () => {
    expect(durationOf({ startedAt: NOW - 600, completedAt: NOW - 300 }, NOW)).toBe(300)
  })

  it('never returns a negative duration', () => {
    expect(durationOf({ startedAt: NOW + 100, completedAt: null }, NOW)).toBe(0)
  })
})
