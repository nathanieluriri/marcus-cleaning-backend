import { notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from './principal'
import * as reviewRepo from '@/server/repositories/review-repo'
import type { ReviewOut } from '@/server/schemas/review'

/**
 * Review access checks.
 * Ported from `security/review_access_check.py`.
 *
 * Reads are open-ish (handled at the route guard); mutations (update/delete)
 * require the authenticated customer to be the review's author/owner.
 * See: docs/migration/06-services-and-repositories.md
 */

/**
 * Load a review and assert the principal is its author. Throws 404 if the
 * review does not exist, 403 if the caller is not the owner.
 */
export async function assertAuthorCanMutate(
  principal: AuthPrincipal,
  reviewId: string,
): Promise<ReviewOut> {
  const raw = await reviewRepo.findRawById(reviewId)
  if (!raw) throw notFound('Review not found')
  if (raw.customer_id !== principal.userId) {
    throw forbidden('You are not allowed to modify this review')
  }
  return reviewRepo.getById(reviewId) as Promise<ReviewOut>
}
