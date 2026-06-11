import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as reviewRepo from '@/server/repositories/review-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import {
  CleanerSelfProfileOut,
  splitFullName,
  type CleanerProfileUpdateRequest,
} from '@/server/schemas/cleaner-job'
import type { CleanerDoc } from '@/server/schemas/cleaner'
import type { WithId } from 'mongodb'

/** Cleaner self-profile read/update (spec §5.2.11). Derives rating/reviews/completedJobs. */

async function toSelfProfile(doc: WithId<CleanerDoc>): Promise<CleanerSelfProfileOut> {
  const id = String(doc._id)
  const [agg, completedJobs] = await Promise.all([
    reviewRepo.aggregateForCleaner(id),
    bookingRepo.countForCleaner(id, 'COMPLETED'),
  ])
  return CleanerSelfProfileOut.parse({
    id,
    fullName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email,
    phone: doc.phoneNumber ?? null,
    bio: doc.bio ?? null,
    rating: agg.average,
    reviewsCount: agg.count,
    completedJobs,
    serviceRadiusMiles: doc.serviceRadiusMiles ?? null,
    services: doc.skills ?? [],
    availableDays: doc.availableDays ?? [],
    avatarUrl: null,
  })
}

export async function getSelf(principal: AuthPrincipal): Promise<CleanerSelfProfileOut> {
  const doc = await cleanerRepo.findById(principal.userId)
  if (!doc) throw notFound('Cleaner not found')
  return toSelfProfile(doc)
}

export async function updateSelf(
  principal: AuthPrincipal,
  patch: CleanerProfileUpdateRequest,
): Promise<CleanerSelfProfileOut> {
  const update: Partial<CleanerDoc> = {}
  if (patch.fullName !== undefined) {
    const { firstName, lastName } = splitFullName(patch.fullName)
    update.firstName = firstName
    update.lastName = lastName
  }
  if (patch.email !== undefined) update.email = patch.email.toLowerCase()
  if (patch.phone !== undefined) update.phoneNumber = patch.phone
  if (patch.bio !== undefined) update.bio = patch.bio
  if (patch.serviceRadiusMiles !== undefined) update.serviceRadiusMiles = patch.serviceRadiusMiles
  if (patch.services !== undefined) update.skills = patch.services
  if (patch.availableDays !== undefined) update.availableDays = patch.availableDays

  await cleanerRepo.updateCleaner(principal.userId, update)
  const doc = await cleanerRepo.findById(principal.userId)
  if (!doc) throw notFound('Cleaner not found')
  return toSelfProfile(doc)
}
