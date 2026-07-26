import { badRequest } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as availabilityRepo from '@/server/repositories/availability-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as sessionRepo from '@/server/repositories/job-session-repo'
import * as reviewRepo from '@/server/repositories/review-repo'
import { mapBookingToCleanerJob, type CleanerJobOut } from '@/server/schemas/cleaner-job'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import type {
  AvailabilityOut,
  AvailabilityUpdateRequest,
  ScheduleDay,
  ScheduleOut,
  TodayOut,
} from '@/server/schemas/availability'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Cleaner availability (weekly pattern + dated overrides), the calendar
 * schedule, and the jobs-dashboard "today" aggregate.
 */

const DAY = 86400

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function dayStart(epoch: number): number {
  return Math.floor(epoch / DAY) * DAY
}

// --- availability -----------------------------------------------------------

export async function getAvailability(principal: AuthPrincipal): Promise<AvailabilityOut> {
  const ts = nowEpoch()
  return availabilityRepo.getOrCreate({
    cleanerId: principal.userId,
    weekly: [],
    overrides: [],
    timezone: 'UTC',
    acceptingJobs: true,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

/**
 * Replace the availability pattern. `weekly` and `overrides` are whole-array
 * replacements (the settings screen edits the full week at once); omitted keys
 * are left as they are.
 */
export async function updateAvailability(args: {
  principal: AuthPrincipal
  payload: AvailabilityUpdateRequest
}): Promise<AvailabilityOut> {
  await getAvailability(args.principal) // ensure the document exists

  if (args.payload.overrides) {
    const seen = new Set<string>()
    for (const o of args.payload.overrides) {
      if (seen.has(o.date)) throw badRequest(`Duplicate override for ${o.date}`, { date: o.date })
      seen.add(o.date)
      for (const w of o.windows) {
        if (w.start >= w.end) {
          throw badRequest(`Override window for ${o.date} must start before it ends`, { date: o.date })
        }
      }
    }
  }

  const set: Record<string, unknown> = {}
  if (args.payload.weekly !== undefined) set.weekly = args.payload.weekly
  if (args.payload.overrides !== undefined) set.overrides = args.payload.overrides
  if (args.payload.timezone !== undefined) set.timezone = args.payload.timezone
  if (args.payload.acceptingJobs !== undefined) set.acceptingJobs = args.payload.acceptingJobs

  const updated = await availabilityRepo.update(args.principal.userId, set)
  return updated!
}

// --- job enrichment (shared by schedule + today) ----------------------------

async function enrich(b: BookingOut): Promise<CleanerJobOut> {
  const [customer, service] = await Promise.all([
    customerRepo.findById(b.customer_id),
    b.serviceId ? generic.getDocById('service_definitions', b.serviceId) : Promise.resolve(null),
  ])
  const clientName = customer ? `${customer.firstName} ${customer.lastName}`.trim() || 'Customer' : 'Customer'
  const rawTitle = service?.title ?? service?.name
  const title = typeof rawTitle === 'string' ? rawTitle : 'Cleaning'
  return mapBookingToCleanerJob(b, { title, clientName, address: b.formattedAddress ?? null })
}

// --- schedule ---------------------------------------------------------------

/** Jobs grouped by day for the calendar screen. */
export async function getSchedule(args: {
  principal: AuthPrincipal
  from?: number
  to?: number
}): Promise<ScheduleOut> {
  const from = dayStart(args.from ?? nowEpoch())
  const to = args.to ?? from + 30 * DAY
  if (to <= from) throw badRequest('`to` must be after `from`', { from, to })

  const bookings = await bookingRepo.getBookings({ cleanerId: args.principal.userId })
  const inWindow = bookings.filter(
    (b) => b.schedule >= from && b.schedule < to && b.status !== 'CANCELLED',
  )
  const jobs = await Promise.all(inWindow.map(enrich))

  const byDay = new Map<number, ScheduleDay>()
  for (let d = from; d < to; d += DAY) byDay.set(d, { date: d, jobs: [], earnings: 0 })

  inWindow.forEach((booking, i) => {
    const key = dayStart(booking.schedule)
    const bucket = byDay.get(key) ?? { date: key, jobs: [], earnings: 0 }
    bucket.jobs.push(jobs[i])
    bucket.earnings = round2(bucket.earnings + (booking.price ?? 0))
    byDay.set(key, bucket)
  })

  return { from, to, days: [...byDay.values()].sort((a, b) => a.date - b.date) }
}

// --- today ------------------------------------------------------------------

/**
 * The jobs-dashboard header: today's schedule, the next job, and the
 * earned / hours / rating stat row.
 */
export async function getToday(principal: AuthPrincipal): Promise<TodayOut> {
  const now = nowEpoch()
  const from = dayStart(now)
  const to = from + DAY

  const [bookings, sessions, rating] = await Promise.all([
    bookingRepo.getBookings({ cleanerId: principal.userId }),
    sessionRepo.completedBetween(principal.userId, from, to, now),
    reviewRepo.aggregateForCleaner(principal.userId),
  ])

  const todays = bookings
    .filter((b) => b.schedule >= from && b.schedule < to && b.status !== 'CANCELLED')
    .sort((a, b) => a.schedule - b.schedule)
  const jobs = await Promise.all(todays.map(enrich))

  const nextIndex = todays.findIndex((b) => b.status === 'PENDING' || b.status === 'ACCEPTED')

  let earned = 0
  let seconds = 0
  let currency: string | null = null
  for (const s of sessions) {
    earned += s.payout ?? 0
    seconds += s.durationSeconds
    currency ??= s.currency
  }

  return {
    stats: {
      earnedToday: round2(earned),
      hoursToday: round2(seconds / 3600),
      jobsToday: todays.length,
      rating: round2(rating.average),
      currency,
    },
    nextJob: nextIndex >= 0 ? jobs[nextIndex] : null,
    jobs,
  }
}
