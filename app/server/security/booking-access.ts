import { notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from './principal'
import * as bookingRepo from '@/server/repositories/booking-repo'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Resource-load access guards for bookings.
 * Ported from `security/booking_access_check.py`.
 *
 * These are plain helpers (no Hono types) so they can be reused by routes,
 * services, and cron. They load the booking and assert the principal — the
 * owning customer or the assigned cleaner — may view it.
 *
 * See: docs/migration/06-services-and-repositories.md
 */

/** True if the principal owns (customer) or is assigned to (cleaner) the booking. */
export function principalCanView(principal: AuthPrincipal, booking: BookingOut): boolean {
  if (principal.role === 'admin') return true
  if (principal.role === 'customer') return booking.customer_id === principal.userId
  if (principal.role === 'cleaner') return booking.cleaner_id === principal.userId
  return false
}

/**
 * Load a booking and assert the principal may view it.
 * Throws `notFound` (404) if missing, `forbidden` (403) if not permitted.
 */
export async function loadViewableBooking(
  principal: AuthPrincipal,
  bookingId: string,
): Promise<BookingOut> {
  const booking = await bookingRepo.getBookingById(bookingId)
  if (!booking) throw notFound('Booking not found')
  if (!principalCanView(principal, booking)) {
    throw forbidden('You do not have access to this booking')
  }
  return booking
}

/**
 * Load a booking and assert the principal is the owning customer.
 * Used by customer-only actions (acknowledge, mark-paid, ratings).
 */
export async function loadCustomerBooking(
  principal: AuthPrincipal,
  bookingId: string,
): Promise<BookingOut> {
  const booking = await bookingRepo.getBookingById(bookingId)
  if (!booking) throw notFound('Booking not found')
  if (principal.role !== 'customer' || booking.customer_id !== principal.userId) {
    throw forbidden('You do not have access to this booking')
  }
  return booking
}

/**
 * Load a booking for a cleaner action (accept/complete). The cleaner must be
 * the assigned cleaner; an unassigned (PENDING, cleaner_id null) booking can be
 * claimed on accept, so `allowUnassigned` relaxes the assignment check.
 */
export async function loadCleanerBooking(
  principal: AuthPrincipal,
  bookingId: string,
  opts: { allowUnassigned?: boolean } = {},
): Promise<BookingOut> {
  const booking = await bookingRepo.getBookingById(bookingId)
  if (!booking) throw notFound('Booking not found')
  if (principal.role !== 'cleaner') throw forbidden('You do not have access to this booking')
  const assignedToMe = booking.cleaner_id === principal.userId
  const claimable = opts.allowUnassigned === true && booking.cleaner_id == null
  if (!assignedToMe && !claimable) {
    throw forbidden('You do not have access to this booking')
  }
  return booking
}
