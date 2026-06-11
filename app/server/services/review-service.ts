import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { assertAuthorCanMutate } from '@/server/security/review-access'
import * as reviewRepo from '@/server/repositories/review-repo'
import type {
  ReviewCreateRequest,
  ReviewUpdateRequest,
  ReviewOut,
} from '@/server/schemas/review'
import { timePeriodToSince } from '@/server/schemas/cleaner-directory'

/**
 * Review CRUD business logic.
 * Ported from `review_service.py`. No HTTP types here.
 * See: docs/migration/06-services-and-repositories.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** List reviews with optional cleaner / stars / time-period filters (hybrid). */
export async function listReviews(filter: {
  cleaner_id?: string
  stars?: number
  timePeriod?: 'all' | 'last30Days' | 'last90Days' | 'lastYear'
  pageSize?: number
} = {}): Promise<ReviewOut[]> {
  let items = await reviewRepo.list({ cleaner_id: filter.cleaner_id })
  if (filter.stars) items = items.filter((r) => r.rating === filter.stars)
  if (filter.timePeriod && filter.timePeriod !== 'all') {
    const since = timePeriodToSince(filter.timePeriod, Math.floor(Date.now() / 1000))
    if (since !== undefined) items = items.filter((r) => (r.dateCreated ?? 0) >= since)
  }
  if (filter.pageSize) items = items.slice(0, filter.pageSize)
  return items
}

/** Get a single review by id. Open-ish read. */
export async function getReview(id: string): Promise<ReviewOut> {
  const review = await reviewRepo.getById(id)
  if (!review) throw notFound('Review not found')
  return review
}

/** Create a review authored by the calling customer. */
export async function createReview(args: {
  principal: AuthPrincipal
  payload: ReviewCreateRequest
}): Promise<ReviewOut> {
  const ts = nowEpoch()
  return reviewRepo.insert({
    customer_id: args.principal.userId,
    cleaner_id: args.payload.cleaner_id,
    booking_id: args.payload.booking_id ?? null,
    rating: args.payload.rating,
    comment: args.payload.comment ?? null,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

/** Update a review — only the author may do so. */
export async function updateReview(args: {
  principal: AuthPrincipal
  id: string
  payload: ReviewUpdateRequest
}): Promise<ReviewOut> {
  await assertAuthorCanMutate(args.principal, args.id)
  const patch: Record<string, unknown> = { lastUpdated: nowEpoch() }
  if (args.payload.rating !== undefined) patch.rating = args.payload.rating
  if (args.payload.comment !== undefined) patch.comment = args.payload.comment
  const updated = await reviewRepo.update(args.id, patch)
  if (!updated) throw notFound('Review not found')
  return updated
}

/** Delete a review — only the author may do so. */
export async function deleteReview(args: { principal: AuthPrincipal; id: string }): Promise<void> {
  await assertAuthorCanMutate(args.principal, args.id)
  const deleted = await reviewRepo.remove(args.id)
  if (!deleted) throw notFound('Review not found')
}
