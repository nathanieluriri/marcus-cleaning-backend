import { badRequest, notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadCleanerBooking } from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import * as savedAddressRepo from '@/server/repositories/saved-address-repo'
import { distanceMiles, toCoordinates, type Coordinates } from '@/server/services/geo'
import {
  mapBookingToCleanerJob,
  type CleanerJobListQuery,
  type CleanerJobOut,
} from '@/server/schemas/cleaner-job'
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

/**
 * The booking's location, from the customer's saved address for that place.
 * Returns null when the address was never saved with coordinates.
 */
async function locationOf(b: BookingOut): Promise<{ coords: Coordinates | null; address: string | null }> {
  if (!b.place_id) return { coords: null, address: null }
  const addr = await savedAddressRepo.findByPlaceId(b.customer_id, b.place_id)
  if (!addr) return { coords: null, address: null }
  return {
    coords: toCoordinates(addr.latitude, addr.longitude),
    address: addr.formattedAddress ?? addr.label ?? null,
  }
}

/**
 * Enrich a BookingOut into a CleanerJob (client name, service title, address),
 * computing a real `distanceMiles` when the caller gave us their position.
 */
async function enrich(b: BookingOut, origin?: Coordinates | null): Promise<CleanerJobOut> {
  const [name, title, location] = await Promise.all([
    clientName(b.customer_id),
    serviceTitle(b.serviceId),
    locationOf(b),
  ])
  const job = mapBookingToCleanerJob(b, { title, clientName: name, address: location.address })
  if (origin && location.coords) job.distanceMiles = distanceMiles(origin, location.coords)
  return job
}

/**
 * The cleaner's job feed: assigned + unassigned pool, minus declined.
 *
 * Filtering by radius requires coordinates from the caller. Without them the
 * radius is ignored rather than silently filtering everything out — an empty
 * Available Jobs tab is worse than an unfiltered one.
 */
export async function listJobs(
  principal: AuthPrincipal,
  query?: CleanerJobListQuery,
): Promise<CleanerJobOut[]> {
  const q = query ?? { scope: 'all' as const, sort: 'schedule' as const }
  const bookings = await bookingRepo.getCleanerJobFeed(principal.userId)
  const origin = toCoordinates(q.lat, q.lng)

  const scoped = bookings.filter((b) => {
    if (q.scope === 'assigned' && b.cleaner_id !== principal.userId) return false
    if (q.scope === 'available' && b.cleaner_id != null) return false
    if (q.status && b.status !== q.status) return false
    if (q.from != null && b.schedule < q.from) return false
    if (q.to != null && b.schedule >= q.to) return false
    return true
  })

  let items = await Promise.all(scoped.map((b) => enrich(b, origin)))

  if (origin && q.radiusMiles != null) {
    // A job with no resolvable coordinates is kept: excluding it would hide
    // real work because of missing address data rather than distance.
    items = items.filter((j) => j.distanceMiles == null || j.distanceMiles <= q.radiusMiles!)
  }

  if (q.sort === 'distance' && origin) {
    items.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
  }

  return items
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
