import { badRequest } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadViewableBooking } from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import { computeCancellation, canReschedule } from '@/server/services/cancellation-policy'
import { enrichBooking } from '@/server/services/booking-enrichment'
import { notifyBookingParties } from '@/server/services/notification-dispatch'
import * as bookingRepo from '@/server/repositories/booking-repo'
import type { BookingCancellationOut, BookingOut } from '@/server/schemas/booking'

/**
 * Booking cancellation + rescheduling. Both actions are available to the
 * customer AND the assigned cleaner; the fee policy is server-owned and lives
 * in the pure `cancellation-policy` module. No HTTP types here.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Cancel a booking. Returns the updated booking plus the fee breakdown applied. */
export async function cancelBooking(args: {
  principal: AuthPrincipal
  bookingId: string
  reason?: string | null
}): Promise<BookingCancellationOut> {
  const booking = await loadViewableBooking(args.principal, args.bookingId)
  const now = nowEpoch()

  // Validates the transition (PENDING/ACCEPTED -> CANCELLED) and throws 400 otherwise.
  const status = applyTransition(booking.status, 'CANCELLED')

  const outcome = computeCancellation({
    schedule: booking.schedule,
    now,
    price: booking.price,
    wasAccepted: booking.status === 'ACCEPTED',
  })

  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    cancelledAt: now,
    cancelledBy: args.principal.role === 'cleaner' ? 'cleaner' : 'customer',
    cancellationReason: args.reason ?? null,
    cancellationFee: outcome.fee,
    lastUpdated: now,
  })

  await notifyBookingParties({
    booking: updated!,
    actorRole: args.principal.role,
    title: 'Booking cancelled',
    body: args.reason
      ? `The booking was cancelled: ${args.reason}`
      : 'The booking was cancelled.',
    type: 'booking.cancelled',
  })

  return {
    booking: await enrichBooking(updated!),
    fee: outcome.fee,
    feePercent: outcome.feePercent,
    refund: outcome.refund,
    currency: booking.currency,
    policy: outcome.policy,
    hoursUntilStart: outcome.hoursUntilStart,
  }
}

/** Move a booking to a new start time. Only valid before the job has started. */
export async function rescheduleBooking(args: {
  principal: AuthPrincipal
  bookingId: string
  schedule: number
  reason?: string | null
}): Promise<BookingOut> {
  const booking = await loadViewableBooking(args.principal, args.bookingId)
  const now = nowEpoch()

  if (booking.status !== 'PENDING' && booking.status !== 'ACCEPTED') {
    throw badRequest(`Cannot reschedule a booking with status ${booking.status}`, {
      status: booking.status,
    })
  }

  const check = canReschedule({ schedule: booking.schedule, newSchedule: args.schedule, now })
  if (!check.allowed) throw badRequest(check.reason, { schedule: booking.schedule })

  const updated = await bookingRepo.updateBooking(booking.id, {
    schedule: args.schedule,
    rescheduleCount: (booking.rescheduleCount ?? 0) + 1,
    lastUpdated: now,
  })

  await notifyBookingParties({
    booking: updated!,
    actorRole: args.principal.role,
    title: 'Booking rescheduled',
    body: 'The booking start time has changed.',
    type: 'booking.rescheduled',
  })

  return enrichBooking(updated!)
}
