import { describe, expect, it } from 'vitest'
import {
  CleanerCardOut,
  CleanerReviewListOut,
  averageRating,
  timePeriodToSince,
} from '@/server/schemas/cleaner-directory'

describe('cleaner-directory helpers', () => {
  it('averageRating returns 0 for empty', () => {
    expect(averageRating([])).toBe(0)
  })

  it('averageRating rounds to one decimal', () => {
    expect(averageRating([5, 4, 4])).toBe(4.3)
  })

  it('timePeriodToSince maps windows relative to now', () => {
    const now = 1_000_000
    expect(timePeriodToSince('all', now)).toBeUndefined()
    expect(timePeriodToSince('last30Days', now)).toBe(now - 30 * 86400)
    expect(timePeriodToSince('last90Days', now)).toBe(now - 90 * 86400)
    expect(timePeriodToSince('lastYear', now)).toBe(now - 365 * 86400)
  })

  it('CleanerCardOut stubs unknown fields to null', () => {
    const c = CleanerCardOut.parse({ id: 'c1', name: 'Jane D', rating: 4.5, jobsDone: 12 })
    expect(c.hourlyRate).toBeNull()
    expect(c.avatarUrl).toBeNull()
    expect(c.isVerified).toBe(false)
  })

  it('CleanerReviewListOut wraps items + nextCursor', () => {
    const r = CleanerReviewListOut.parse({
      items: [{ id: 'r1', reviewerName: 'Ada', rating: 5, text: 'Great', timestamp: 1 }],
      nextCursor: null,
    })
    expect(r.items[0].avatarUrl).toBeNull()
  })
})
