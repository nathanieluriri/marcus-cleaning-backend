import { z } from '@hono/zod-openapi'

/**
 * Customer-facing cleaner discovery: browse cards, public profile, and
 * cleaner-scoped reviews. Fields not present in the cleaner data model
 * (hourlyRate, yearsExperience, certifications, avatar) are nullable stubs —
 * see spec §7. rating/jobsDone are DERIVED (reviews / bookings) by the service.
 */

// --- query params ----------------------------------------------------------

export const CleanerBrowseQuery = z
  .object({
    minRating: z.coerce.number().min(0).max(5).optional(),
    maxHourlyRate: z.coerce.number().min(0).optional(),
    onlyAvailableNow: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .openapi('CleanerBrowseQuery')
export type CleanerBrowseQuery = z.infer<typeof CleanerBrowseQuery>

export const ReviewTimePeriod = z.enum(['all', 'last30Days', 'last90Days', 'lastYear'])
export type ReviewTimePeriod = z.infer<typeof ReviewTimePeriod>

export const CleanerReviewQuery = z
  .object({
    cursor: z.string().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    stars: z.coerce.number().int().min(1).max(5).optional(),
    timePeriod: ReviewTimePeriod.default('all'),
  })
  .openapi('CleanerReviewQuery')
export type CleanerReviewQuery = z.infer<typeof CleanerReviewQuery>

// --- outputs ---------------------------------------------------------------

export const CleanerCardOut = z
  .object({
    id: z.string(),
    name: z.string(),
    rating: z.number().default(0),
    jobsDone: z.number().int().default(0),
    hourlyRate: z.number().nullable().default(null),
    isVerified: z.boolean().default(false),
    avatarUrl: z.string().nullable().default(null),
    roleLabel: z.string().nullable().default(null),
    yearsExperience: z.number().int().nullable().default(null),
    bookingsCount: z.number().int().default(0),
    heroImageUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerCardOut')
export type CleanerCardOut = z.infer<typeof CleanerCardOut>

export const CleanerReviewOut = z
  .object({
    id: z.string(),
    reviewerName: z.string(),
    rating: z.number(),
    text: z.string().nullable().default(null),
    timestamp: z.number().int().nullable().default(null),
    avatarUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerReviewOut')
export type CleanerReviewOut = z.infer<typeof CleanerReviewOut>

export const CleanerReviewListOut = z
  .object({
    items: z.array(CleanerReviewOut),
    nextCursor: z.string().nullable().default(null),
  })
  .openapi('CleanerReviewListOut')
export type CleanerReviewListOut = z.infer<typeof CleanerReviewListOut>

export const CleanerPublicProfileOut = z
  .object({
    id: z.string(),
    name: z.string(),
    yearsExperience: z.number().int().nullable().default(null),
    roleLabel: z.string().nullable().default(null),
    heroImageUrl: z.string().nullable().default(null),
    rating: z.number().default(0),
    reviewsCount: z.number().int().default(0),
    bookingsCount: z.number().int().default(0),
    hourlyRate: z.number().nullable().default(null),
    certifications: z.array(z.string()).default([]),
    about: z.string().nullable().default(null),
    reviewPreview: z.array(CleanerReviewOut).default([]),
  })
  .openapi('CleanerPublicProfileOut')
export type CleanerPublicProfileOut = z.infer<typeof CleanerPublicProfileOut>

// --- pure helpers (unit-tested) --------------------------------------------

/** Mean of ratings, rounded to one decimal; 0 for an empty set. */
export function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0
  const sum = ratings.reduce((a, b) => a + b, 0)
  return Math.round((sum / ratings.length) * 10) / 10
}

/** Convert a time-period token to an inclusive `since` epoch (seconds), or undefined for 'all'. */
export function timePeriodToSince(period: ReviewTimePeriod, now: number): number | undefined {
  switch (period) {
    case 'last30Days':
      return now - 30 * 86400
    case 'last90Days':
      return now - 90 * 86400
    case 'lastYear':
      return now - 365 * 86400
    default:
      return undefined
  }
}
