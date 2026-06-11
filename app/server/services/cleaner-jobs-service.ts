import { badRequest, notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadCleanerBooking } from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import { mapBookingToCleanerJob, type CleanerJobOut } from '@/server/schemas/cleaner-job'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Cleaner "jobs" surface mapped over the `bookings` collection (spec §2.3, §5.2).
 * Decline = "this cleaner passes; the booking stays in the pool" (spec §8): it
 * records the cleaner in `declinedBy` and removes the job from their feed; the
 * booking status is unchanged.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

async function clientName(customerId: string): Promise<string> {
  const c = await customerRepo.findById(customerId)
  if (!c) return 'Customer'
  return `${c.firstName} ${c.lastName}`.trim() || 'Customer'
}

async function serviceTitle(serviceId: string | null): Promise<string> {
  if (!serviceId) return 'Cleaning'
  const doc = await generic.getDocById('service_definitions', serviceId)
  const title = doc?.title ?? doc?.name
  return typeof title === 'string' ? title : 'Cleaning'
}

/** Enrich a BookingOut into a CleanerJob (resolves client name, service title, address). */
async function enrich(b: BookingOut): Promise<CleanerJobOut> {
  const [name, title] = await Promise.all([clientName(b.customer_id), serviceTitle(b.serviceId)])
  return mapBookingToCleanerJob(b, { title, clientName: name, address: null })
}

/** The cleaner's job feed: assigned + unassigned pool, minus declined. */
export async function listJobs(principal: AuthPrincipal): Promise<CleanerJobOut[]> {
  const bookings = await bookingRepo.getCleanerJobFeed(principal.userId)
  return Promise.all(bookings.map(enrich))
}

/** A single job, visible to this cleaner (assigned to them or an open pool job). */
export async function getJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await bookingRepo.getBookingById(jobId)
  if (!booking) throw notFound('Job not found')
  const isAssignedToMe = booking.cleaner_id === principal.userId
  const isOpenPool = booking.cleaner_id === null && booking.status === 'PENDING'
  if (!isAssignedToMe && !isOpenPool) throw forbidden('You cannot view this job')
  return enrich(booking)
}

/** Accept a job: claim it + transition PENDING→ACCEPTED. */
export async function acceptJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await loadCleanerBooking(principal, jobId, { allowUnassigned: true })
  const status = applyTransition(booking.status, 'ACCEPTED')
  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    cleaner_id: principal.userId,
    acceptedAt: nowEpoch(),
    lastUpdated: nowEpoch(),
  })
  return enrich(updated!)
}

/** Decline a job: only valid for open pool jobs not yet accepted by this cleaner. */
export async function declineJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await bookingRepo.getBookingById(jobId)
  if (!booking) throw notFound('Job not found')
  if (booking.cleaner_id && booking.cleaner_id !== principal.userId) {
    throw badRequest('This job is already assigned to another cleaner')
  }
  if (booking.cleaner_id === principal.userId) {
    throw badRequest('You have already accepted this job; use cancel instead')
  }
  await bookingRepo.addDecline(jobId, principal.userId)
  return enrich(booking)
}
