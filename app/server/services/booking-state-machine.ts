import { badRequest } from '@/server/core/errors'
import type { BookingStatus } from '@/server/schemas/booking'

/**
 * Booking status state machine — system-owned transitions.
 * Ported from `services/booking_state_machine.py`.
 *
 * Happy path: PENDING -> ACCEPTED -> COMPLETED -> ACKNOWLEDGED.
 * CANCELLED is a terminal sink reachable from the pre-completion states.
 * Pure functions only — no Hono/HTTP or DB types.
 *
 * See: docs/migration/06-services-and-repositories.md
 */

/** Allowed forward transitions keyed by current status. */
const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: [],
  CANCELLED: [],
}

/** True if `from -> to` is a permitted transition. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

/**
 * Validate a transition, returning the target status. Throws `badRequest` (400)
 * on an illegal transition so callers can apply the result directly.
 */
export function applyTransition(from: BookingStatus, to: BookingStatus): BookingStatus {
  if (!canTransition(from, to)) {
    throw badRequest(`Cannot transition booking from ${from} to ${to}`, {
      from,
      to,
      allowed: ALLOWED[from] ?? [],
    })
  }
  return to
}
