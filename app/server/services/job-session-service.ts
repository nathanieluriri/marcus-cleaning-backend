import { badRequest, notFound } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadCleanerBooking } from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import { buildChecklist } from '@/server/services/checklist-service'
import { notify, notifyBookingParties } from '@/server/services/notification-dispatch'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as sessionRepo from '@/server/repositories/job-session-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import type { BookingOut } from '@/server/schemas/booking'
import type {
  ChecklistTask,
  JobCompletionOut,
  JobSessionOut,
  SosAlertOut,
  SosRequest,
} from '@/server/schemas/job-session'

/**
 * The in-progress job: server-owned start time, checklist state, completion,
 * and the SOS alert. Everything the staff app used to keep in widget state.
 *
 * No HTTP types here — cron and admin tooling reuse the same functions.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Split a gross job price into the cleaner's take-home and platform commission. */
export function splitPayout(gross: number, commissionPercent: number): { earnings: number; commission: number } {
  const commission = round2((gross * commissionPercent) / 100)
  return { earnings: round2(gross - commission), commission }
}

/**
 * Cleaner declares they are on the way. This is what lights up the customer's
 * "your cleaner is on the way" bar, so it exists as its own step rather than
 * being inferred from the job start.
 */
export async function markEnRoute(args: {
  principal: AuthPrincipal
  bookingId: string
  etaAt?: number | null
  etaMinutes?: number | null
}): Promise<JobSessionOut> {
  const booking = await loadCleanerBooking(args.principal, args.bookingId)
  if (booking.status !== 'ACCEPTED') {
    throw badRequest(`Only an accepted job can be started (current status: ${booking.status})`, {
      status: booking.status,
    })
  }

  const now = nowEpoch()
  const etaAt = args.etaAt ?? (args.etaMinutes != null ? now + args.etaMinutes * 60 : null)

  const existing = await sessionRepo.getByBookingId(booking.id, now)
  if (existing) {
    if (existing.status === 'COMPLETED') throw badRequest('This job is already completed')
    // Already started or already en route — just refresh the ETA.
    const updated = await sessionRepo.updateSession(
      booking.id,
      { etaAt, enRouteAt: existing.enRouteAt ?? now },
      now,
    )
    await notifyEnRoute(booking, etaAt)
    return updated!
  }

  // startedAt stays 0 until work actually begins, so the working timer and the
  // travel phase never get conflated.
  const checklist = await buildChecklist({ serviceId: booking.serviceId, addons: booking.addons })
  const session = await sessionRepo.startSession(
    {
      bookingId: booking.id,
      cleanerId: args.principal.userId,
      status: 'EN_ROUTE',
      enRouteAt: now,
      etaAt,
      startedAt: 0,
      completedAt: null,
      checklist,
      payout: null,
      currency: booking.currency ?? null,
      dateCreated: now,
      lastUpdated: now,
    },
    now,
  )

  await notifyEnRoute(booking, etaAt)
  return session
}

async function notifyEnRoute(booking: BookingOut, etaAt: number | null): Promise<void> {
  const when = etaAt ? ` Estimated arrival in about ${Math.max(1, Math.round((etaAt - nowEpoch()) / 60))} minutes.` : ''
  await notifyBookingParties({
    booking,
    actorRole: 'cleaner',
    title: 'Your cleaner is on the way',
    body: `Your cleaner is heading to your address.${when}`,
    type: 'job.en_route',
    // Both forms: `etaAt` is unix EPOCH SECONDS (consistent with the rest of the
    // API), `etaAtIso` is ISO-8601 UTC for clients that would rather not guess
    // the unit.
    data: etaAt ? { etaAt, etaAtIso: new Date(etaAt * 1000).toISOString() } : undefined,
  })
}

/**
 * Start the job. Idempotent by construction: a repeat call returns the existing
 * session with its original `startedAt`, so a crash-and-relaunch resumes the
 * same timer rather than restarting it.
 */
export async function startJob(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<JobSessionOut> {
  const booking = await loadCleanerBooking(args.principal, args.bookingId)
  if (booking.status !== 'ACCEPTED') {
    throw badRequest(`A job can only be started once accepted (current status: ${booking.status})`, {
      status: booking.status,
    })
  }

  const now = nowEpoch()
  const existing = await sessionRepo.getByBookingId(booking.id, now)
  // An EN_ROUTE session exists but work has not begun — promote it in place so
  // the same session carries the whole lifecycle.
  if (existing && existing.status === 'EN_ROUTE') {
    const promoted = await sessionRepo.updateSession(
      booking.id,
      { status: 'IN_PROGRESS', startedAt: now },
      now,
    )
    await notifyStarted(booking)
    return promoted!
  }
  if (existing) return existing

  const checklist = await buildChecklist({ serviceId: booking.serviceId, addons: booking.addons })
  const session = await sessionRepo.startSession(
    {
      bookingId: booking.id,
      cleanerId: args.principal.userId,
      status: 'IN_PROGRESS',
      enRouteAt: null,
      etaAt: null,
      startedAt: now,
      completedAt: null,
      checklist,
      payout: null,
      currency: booking.currency ?? null,
      dateCreated: now,
      lastUpdated: now,
    },
    now,
  )

  await notifyStarted(booking)
  return session
}

async function notifyStarted(booking: BookingOut): Promise<void> {
  await notifyBookingParties({
    booking,
    actorRole: 'cleaner',
    title: 'Your cleaner has started',
    body: 'Your cleaner has arrived and started the job.',
    type: 'job.started',
  })
}

/** Read the current session (404 before the job is started). */
export async function getSession(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<JobSessionOut> {
  await loadCleanerBooking(args.principal, args.bookingId)
  const session = await sessionRepo.getByBookingId(args.bookingId, nowEpoch())
  if (!session) throw notFound('This job has not been started yet')
  return session
}

/** The checklist for a job — built on demand if the job has not started yet. */
export async function getChecklist(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<ChecklistTask[]> {
  const booking = await loadCleanerBooking(args.principal, args.bookingId)
  const session = await sessionRepo.getByBookingId(booking.id, nowEpoch())
  if (session) return session.checklist
  return buildChecklist({ serviceId: booking.serviceId, addons: booking.addons })
}

/** Tick or untick one checklist task. */
export async function toggleTask(args: {
  principal: AuthPrincipal
  bookingId: string
  taskId: string
  done: boolean
}): Promise<JobSessionOut> {
  await loadCleanerBooking(args.principal, args.bookingId)
  const now = nowEpoch()

  const session = await sessionRepo.getByBookingId(args.bookingId, now)
  if (!session) throw notFound('This job has not been started yet')
  if (session.status === 'COMPLETED') throw badRequest('This job is already completed')
  if (session.status === 'EN_ROUTE') throw badRequest('Start the job before ticking tasks')

  const updated = await sessionRepo.setChecklistTask(args.bookingId, args.taskId, args.done, now)
  if (!updated) throw notFound('Checklist task not found')
  return updated
}

/**
 * Complete the job: stamp the end time, transition the booking, and compute the
 * payout. Idempotent — a repeat call returns the original summary rather than
 * re-paying, which matters because the client may retry on a flaky connection.
 */
export async function completeJob(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<JobCompletionOut> {
  const booking = await loadCleanerBooking(args.principal, args.bookingId)
  const now = nowEpoch()
  const commissionPercent = getSettings().PLATFORM_COMMISSION_PERCENT

  const existing = await sessionRepo.getByBookingId(booking.id, now)
  if (!existing) throw badRequest('Start the job before completing it')
  if (existing.status === 'EN_ROUTE') {
    throw badRequest('Start the job before completing it', { status: existing.status })
  }

  if (existing.status === 'COMPLETED') {
    const counts = sessionRepo.countTasks(existing.checklist)
    const gross = booking.price ?? 0
    const { earnings, commission } = splitPayout(gross, commissionPercent)
    return {
      session: existing,
      durationSeconds: existing.durationSeconds,
      earnings: existing.payout ?? earnings,
      commission,
      grossAmount: round2(gross),
      currency: existing.currency ?? booking.currency,
      tasksCompleted: counts.done,
      tasksTotal: counts.total,
    }
  }

  const gross = booking.price ?? 0
  const { earnings, commission } = splitPayout(gross, commissionPercent)

  const session = await sessionRepo.updateSession(
    booking.id,
    { status: 'COMPLETED', completedAt: now, payout: earnings, currency: booking.currency ?? null },
    now,
  )

  // Booking may already be COMPLETED if the cleaner used the booking endpoint;
  // only transition when the state machine allows it.
  if (booking.status === 'ACCEPTED') {
    const status = applyTransition(booking.status, 'COMPLETED')
    await bookingRepo.updateBooking(booking.id, { status, completedAt: now, lastUpdated: now })
  }

  await notifyBookingParties({
    booking,
    actorRole: 'cleaner',
    title: 'Cleaning complete',
    body: 'Your cleaner has finished the job.',
    type: 'job.completed',
  })

  const counts = sessionRepo.countTasks(session!.checklist)
  return {
    session: session!,
    durationSeconds: session!.durationSeconds,
    earnings,
    commission,
    grossAmount: round2(gross),
    currency: booking.currency,
    tasksCompleted: counts.done,
    tasksTotal: counts.total,
  }
}

/**
 * Raise an SOS. Safety-critical: the alert is persisted first (so it survives
 * any downstream failure), then every admin is notified. Delivery problems are
 * logged but never surfaced as a failure to the cleaner in danger — the button
 * must always appear to work.
 */
export async function raiseSos(args: {
  principal: AuthPrincipal
  bookingId: string
  payload: SosRequest
}): Promise<SosAlertOut> {
  const booking = await loadCleanerBooking(args.principal, args.bookingId)
  const now = nowEpoch()

  const alert = await sessionRepo.insertAlert({
    bookingId: booking.id,
    cleanerId: args.principal.userId,
    customerId: booking.customer_id,
    kind: args.payload.kind,
    note: args.payload.note ?? null,
    lat: args.payload.lat ?? null,
    lng: args.payload.lng ?? null,
    status: 'OPEN',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    dateCreated: now,
    lastUpdated: now,
  })

  try {
    const cleaner = await cleanerRepo.findById(args.principal.userId)
    const who = cleaner ? `${cleaner.firstName} ${cleaner.lastName}`.trim() : 'A cleaner'
    await notify({
      userId: args.principal.userId,
      role: 'cleaner',
      title: 'SOS received',
      body: 'Your alert has been sent. Support has been notified.',
      type: 'sos.raised',
      data: { alertId: alert.id, bookingId: booking.id },
    })
    console.error('[SOS]', {
      alertId: alert.id,
      bookingId: booking.id,
      cleanerId: args.principal.userId,
      cleaner: who,
      kind: alert.kind,
      lat: alert.lat,
      lng: alert.lng,
      note: alert.note,
    })
  } catch (err) {
    console.error('[SOS] alerting failed (alert IS persisted)', alert.id, err)
  }

  return alert
}
