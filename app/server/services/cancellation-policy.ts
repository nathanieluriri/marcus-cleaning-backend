/**
 * Cancellation fee policy — pure functions, no DB or HTTP types.
 *
 * The fee is a percentage of the booking price, banded by how long before the
 * scheduled start the cancellation happens. Server-owned: the client never
 * computes or proposes a fee, it only displays what this returns.
 *
 *   >= 24h before  -> FREE      (0%)
 *   >= 2h  before  -> LATE      (25%)
 *   <  2h before   -> VERY_LATE (50%)
 *   after start    -> NO_SHOW   (100%)
 *
 * A booking that was never accepted by a cleaner is always free to cancel —
 * nobody has committed time to it yet.
 */

export type CancellationBand = 'FREE' | 'LATE' | 'VERY_LATE' | 'NO_SHOW' | 'UNACCEPTED'

export interface CancellationOutcome {
  policy: CancellationBand
  feePercent: number
  fee: number
  refund: number
  hoursUntilStart: number
}

const BANDS: ReadonlyArray<{ minHours: number; policy: CancellationBand; percent: number }> = [
  { minHours: 24, policy: 'FREE', percent: 0 },
  { minHours: 2, policy: 'LATE', percent: 25 },
  { minHours: 0, policy: 'VERY_LATE', percent: 50 },
]

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Compute the fee for cancelling a booking.
 *
 * @param schedule  scheduled start, unix epoch seconds
 * @param now       reference time, unix epoch seconds
 * @param price     booking price in major units (null -> no fee is computable)
 * @param wasAccepted whether a cleaner had accepted the booking
 */
export function computeCancellation(args: {
  schedule: number
  now: number
  price: number | null
  wasAccepted: boolean
}): CancellationOutcome {
  const hoursUntilStart = round2((args.schedule - args.now) / 3600)
  const price = args.price ?? 0

  if (!args.wasAccepted) {
    return { policy: 'UNACCEPTED', feePercent: 0, fee: 0, refund: round2(price), hoursUntilStart }
  }

  const band =
    hoursUntilStart < 0
      ? { policy: 'NO_SHOW' as const, percent: 100 }
      : (BANDS.find((b) => hoursUntilStart >= b.minHours) ?? { policy: 'VERY_LATE' as const, percent: 50 })

  const fee = round2((price * band.percent) / 100)
  return {
    policy: band.policy,
    feePercent: band.percent,
    fee,
    refund: round2(price - fee),
    hoursUntilStart,
  }
}

/**
 * Whether a booking may be moved to a new start time.
 * Rescheduling is blocked once the job has started or within 2h of the start.
 */
export function canReschedule(args: {
  schedule: number
  newSchedule: number
  now: number
}): { allowed: true } | { allowed: false; reason: string } {
  if (args.newSchedule <= args.now) {
    return { allowed: false, reason: 'The new start time must be in the future' }
  }
  const hoursUntilStart = (args.schedule - args.now) / 3600
  if (hoursUntilStart < 2) {
    return { allowed: false, reason: 'Bookings cannot be rescheduled within 2 hours of the start time' }
  }
  return { allowed: true }
}
