import { notFound } from '@/server/core/errors'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as reviewRepo from '@/server/repositories/review-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import {
  CleanerCardOut,
  CleanerPublicProfileOut,
  CleanerReviewOut,
  CleanerReviewListOut,
  timePeriodToSince,
  type CleanerBrowseQuery,
  type CleanerReviewQuery,
} from '@/server/schemas/cleaner-directory'
import type { ReviewOut } from '@/server/schemas/review'

/**
 * Customer-facing cleaner discovery. rating/reviewsCount derive from `reviews`,
 * jobsDone/bookingsCount from `bookings`; model-absent fields (hourlyRate,
 * yearsExperience, certifications, avatar) are null/empty stubs. See spec §7.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

async function reviewerName(customerId: string): Promise<string> {
  const c = await customerRepo.findById(customerId)
  if (!c) return 'Customer'
  return `${c.firstName} ${c.lastName}`.trim() || 'Customer'
}

async function toCleanerReview(r: ReviewOut): Promise<CleanerReviewOut> {
  return CleanerReviewOut.parse({
    id: r.id,
    reviewerName: await reviewerName(r.customer_id),
    rating: r.rating,
    text: r.comment,
    timestamp: r.dateCreated,
    avatarUrl: null,
  })
}

/** Browse approved cleaners as cards, with derived rating/jobs and client-side filters. */
export async function browse(filter: CleanerBrowseQuery): Promise<CleanerCardOut[]> {
  const cleaners = await cleanerRepo.listApproved()
  const cards = await Promise.all(
    cleaners.map(async (doc) => {
      const id = String(doc._id)
      const [agg, bookingsCount, jobsDone] = await Promise.all([
        reviewRepo.aggregateForCleaner(id),
        bookingRepo.countForCleaner(id),
        bookingRepo.countForCleaner(id, 'COMPLETED'),
      ])
      return CleanerCardOut.parse({
        id,
        name: `${doc.firstName} ${doc.lastName}`.trim(),
        rating: agg.average,
        jobsDone,
        hourlyRate: null,
        isVerified: doc.onboardingStatus === 'APPROVED',
        avatarUrl: null,
        roleLabel: 'Cleaner',
        yearsExperience: null,
        bookingsCount,
        heroImageUrl: null,
      })
    }),
  )
  return cards.filter((card) => {
    if (filter.minRating !== undefined && card.rating < filter.minRating) return false
    if (filter.maxHourlyRate !== undefined && card.hourlyRate !== null && card.hourlyRate > filter.maxHourlyRate)
      return false
    return true // onlyAvailableNow has no backing data yet — no-op (spec §7)
  })
}

/** Public profile for one cleaner, with a short review preview. */
export async function getPublicProfile(cleanerId: string): Promise<CleanerPublicProfileOut> {
  const doc = await cleanerRepo.findById(cleanerId)
  if (!doc || doc.onboardingStatus !== 'APPROVED') throw notFound('Cleaner not found')
  const [agg, bookingsCount, recent] = await Promise.all([
    reviewRepo.aggregateForCleaner(cleanerId),
    bookingRepo.countForCleaner(cleanerId),
    reviewRepo.listForCleanerPaginated({ cleaner_id: cleanerId, pageSize: 3 }),
  ])
  const reviewPreview = await Promise.all(recent.items.map(toCleanerReview))
  return CleanerPublicProfileOut.parse({
    id: cleanerId,
    name: `${doc.firstName} ${doc.lastName}`.trim(),
    yearsExperience: null,
    roleLabel: 'Cleaner',
    heroImageUrl: null,
    rating: agg.average,
    reviewsCount: agg.count,
    bookingsCount,
    hourlyRate: null,
    certifications: [],
    about: doc.bio ?? null,
    reviewPreview,
  })
}

/** Cursor-paginated, filterable reviews for one cleaner. */
export async function listCleanerReviews(
  cleanerId: string,
  query: CleanerReviewQuery,
): Promise<CleanerReviewListOut> {
  const since = timePeriodToSince(query.timePeriod, nowEpoch())
  const page = await reviewRepo.listForCleanerPaginated({
    cleaner_id: cleanerId,
    stars: query.stars,
    since,
    cursor: query.cursor,
    pageSize: query.pageSize,
  })
  const items = await Promise.all(page.items.map(toCleanerReview))
  return CleanerReviewListOut.parse({ items, nextCursor: page.nextCursor })
}
