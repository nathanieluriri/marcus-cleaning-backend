import type { AuthPrincipal } from '@/server/security/principal'
import { loadViewableBooking } from '@/server/security/booking-access'
import * as sessionRepo from '@/server/repositories/job-session-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import { deriveProgressState, type BookingProgressOut } from '@/server/schemas/job-session'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Customer-visible job progress — the "your cleaner is on the way" bar.
 *
 * The job session is a cleaner-side resource, so the customer must not read it
 * directly. This projects the parts they are entitled to see (state, ETA,
 * elapsed time, checklist counts) and nothing else — no payout, no cleaner
 * notes, no raw session document.
 */

/** How often the customer app should poll while a booking is active. */
const POLL_INTERVAL_SECONDS = 20
/** Once nothing is moving, polling can back right off. */
const IDLE_POLL_INTERVAL_SECONDS = 120

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Build the progress view for a booking. Exported so booking reads can embed it
 * without a second round-trip.
 */
export async function progressFor(booking: BookingOut, now = nowEpoch()): Promise<BookingProgressOut> {
  const session = await sessionRepo.getByBookingId(booking.id, now)
  const { state, percent } = deriveProgressState({
    bookingStatus: booking.status,
    sessionStatus: session?.status ?? null,
  })

  const counts = session
    ? sessionRepo.countTasks(session.checklist)
    : { done: 0, total: 0 }

  let cleanerName: string | null = booking.cleanerName ?? null
  let cleanerAvatarUrl: string | null = booking.cleanerAvatarUrl ?? null
  if (!cleanerName && booking.cleaner_id) {
    const cleaner = await cleanerRepo.findById(booking.cleaner_id)
    if (cleaner) {
      cleanerName = `${cleaner.firstName} ${cleaner.lastName}`.trim() || null
      const raw = cleaner as unknown as Record<string, unknown>
      cleanerAvatarUrl = typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null
    }
  }

  const isLive = state === 'EN_ROUTE' || state === 'IN_PROGRESS'

  return {
    bookingId: booking.id,
    state,
    percent,
    // startedAt is 0 on an en-route-only session; surface that as null.
    startedAt: session?.startedAt ? session.startedAt : null,
    enRouteAt: session?.enRouteAt ?? null,
    etaAt: session?.etaAt ?? null,
    completedAt: session?.completedAt ?? booking.completedAt ?? null,
    elapsedSeconds: session?.durationSeconds ?? 0,
    tasksCompleted: counts.done,
    tasksTotal: counts.total,
    cleanerName,
    cleanerAvatarUrl,
    pollIntervalSeconds: isLive ? POLL_INTERVAL_SECONDS : IDLE_POLL_INTERVAL_SECONDS,
  }
}

/** `GET /v1/bookings/{id}/progress` — access-checked. */
export async function getProgress(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<BookingProgressOut> {
  const booking = await loadViewableBooking(args.principal, args.bookingId)
  return progressFor(booking)
}
