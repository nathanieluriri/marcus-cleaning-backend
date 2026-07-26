import { z } from '@hono/zod-openapi'

/**
 * Job session — the server-owned record of a cleaner actually working a job
 * (`job_sessions` collection, one document per booking).
 *
 * The elapsed timer used to live in the staff app's widget state, which meant a
 * crash lost it and nothing stopped a cleaner editing it. `startedAt` and
 * `completedAt` are stamped here instead, and the duration is always derived
 * from them — never accepted from the client.
 *
 * The checklist is derived from the booking's service + add-ons at start time,
 * so it reflects what the customer actually paid for.
 */

export const ChecklistTask = z
  .object({
    taskId: z.string().openapi({ example: 'kitchen-surfaces' }),
    label: z.string().openapi({ example: 'Wipe kitchen surfaces' }),
    /** Which add-on (if any) put this task on the list; null for base service tasks. */
    addonId: z.string().nullable().default(null),
    done: z.boolean().default(false),
    doneAt: z.number().int().nullable().default(null),
  })
  .openapi('ChecklistTask')
export type ChecklistTask = z.infer<typeof ChecklistTask>

export const JobSessionStatus = z.enum(['EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'])
export type JobSessionStatus = z.infer<typeof JobSessionStatus>

/**
 * Customer-visible progress for a booking — the "your cleaner is on the way"
 * bar. Derived from the booking status plus the job session, and exposed on
 * BookingOut so the customer app never has to read a cleaner-side resource.
 *
 * SCHEDULED  booking accepted, cleaner has not set off
 * EN_ROUTE   cleaner tapped "on my way"; `etaAt` may be present
 * IN_PROGRESS cleaner has started; `startedAt` is authoritative
 * COMPLETED  job finished
 */
export const BookingProgressState = z.enum([
  'PENDING',
  'SCHEDULED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
])
export type BookingProgressState = z.infer<typeof BookingProgressState>

export const BookingProgressOut = z
  .object({
    bookingId: z.string(),
    state: BookingProgressState,
    /** 0-100, for the progress bar. Derived; do not compute client-side. */
    percent: z.number().int().min(0).max(100),
    /** Authoritative job start, unix epoch seconds. Null before the job starts. */
    startedAt: z.number().int().nullable().default(null),
    enRouteAt: z.number().int().nullable().default(null),
    /** Cleaner's estimated arrival, unix epoch seconds, when they provided one. */
    etaAt: z.number().int().nullable().default(null),
    completedAt: z.number().int().nullable().default(null),
    /** Elapsed working time so far, seconds. 0 before the job starts. */
    elapsedSeconds: z.number().int().default(0),
    /** Checklist progress, so the customer sees real movement. */
    tasksCompleted: z.number().int().default(0),
    tasksTotal: z.number().int().default(0),
    cleanerName: z.string().nullable().default(null),
    cleanerAvatarUrl: z.string().nullable().default(null),
    /** Recommended poll interval, seconds, while this screen is open. */
    pollIntervalSeconds: z.number().int().default(20),
  })
  .openapi('BookingProgressOut')
export type BookingProgressOut = z.infer<typeof BookingProgressOut>

/** Percentage shown on the customer's progress bar for each state. */
const PROGRESS_PERCENT: Record<BookingProgressState, number> = {
  PENDING: 0,
  SCHEDULED: 10,
  EN_ROUTE: 35,
  IN_PROGRESS: 65,
  COMPLETED: 100,
  CANCELLED: 0,
}

/**
 * Derive the customer-facing state from the booking status and job session.
 * Pure — the single place this mapping is defined.
 */
export function deriveProgressState(args: {
  bookingStatus: 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'ACKNOWLEDGED' | 'CANCELLED'
  sessionStatus?: JobSessionStatus | null
}): { state: BookingProgressState; percent: number } {
  let state: BookingProgressState
  if (args.bookingStatus === 'CANCELLED') state = 'CANCELLED'
  else if (args.bookingStatus === 'COMPLETED' || args.bookingStatus === 'ACKNOWLEDGED') state = 'COMPLETED'
  else if (args.sessionStatus === 'COMPLETED') state = 'COMPLETED'
  else if (args.sessionStatus === 'IN_PROGRESS') state = 'IN_PROGRESS'
  else if (args.sessionStatus === 'EN_ROUTE') state = 'EN_ROUTE'
  else if (args.bookingStatus === 'ACCEPTED') state = 'SCHEDULED'
  else state = 'PENDING'

  return { state, percent: PROGRESS_PERCENT[state] }
}

/** Cleaner declares they are on the way, optionally with an ETA. */
export const EnRouteRequest = z
  .object({
    /** Estimated arrival, unix epoch seconds. */
    etaAt: z.number().int().nullable().optional(),
    /** Alternative to `etaAt`: minutes from now. */
    etaMinutes: z.number().int().min(0).max(600).nullable().optional(),
  })
  .openapi('EnRouteRequest')
export type EnRouteRequest = z.infer<typeof EnRouteRequest>

export const JobSessionOut = z
  .object({
    id: z.string(),
    bookingId: z.string(),
    cleanerId: z.string(),
    status: JobSessionStatus,
    /** Set when the cleaner declared they were on the way. */
    enRouteAt: z.number().int().nullable().default(null),
    /** Cleaner's estimated arrival, unix epoch seconds. */
    etaAt: z.number().int().nullable().default(null),
    /**
     * Authoritative work start, unix epoch seconds. Set by the server, not the
     * app. Zero while the session is only EN_ROUTE (work has not begun).
     */
    startedAt: z.number().int(),
    completedAt: z.number().int().nullable().default(null),
    /** Derived: completedAt (or now) minus startedAt, in seconds. */
    durationSeconds: z.number().int().openapi({ example: 7260 }),
    checklist: z.array(ChecklistTask).default([]),
    /** Payout for the job, in major units. Present once completed. */
    payout: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('JobSessionOut')
export type JobSessionOut = z.infer<typeof JobSessionOut>

/** Tick or untick a checklist item. */
export const ChecklistToggleRequest = z
  .object({ done: z.boolean().openapi({ example: true }) })
  .openapi('ChecklistToggleRequest')
export type ChecklistToggleRequest = z.infer<typeof ChecklistToggleRequest>

/** Completion summary shown on the staff app's job-completion screen. */
export const JobCompletionOut = z
  .object({
    session: JobSessionOut,
    durationSeconds: z.number().int(),
    /** Cleaner's take-home for this job, in major units. */
    earnings: z.number(),
    /** Platform commission withheld, in major units. */
    commission: z.number(),
    grossAmount: z.number(),
    currency: z.string().nullable().default(null),
    tasksCompleted: z.number().int(),
    tasksTotal: z.number().int(),
  })
  .openapi('JobCompletionOut')
export type JobCompletionOut = z.infer<typeof JobCompletionOut>

// --- SOS -------------------------------------------------------------------

export const SosKind = z.enum(['SAFETY', 'MEDICAL', 'PROPERTY', 'OTHER'])
export type SosKind = z.infer<typeof SosKind>

export const SosRequest = z
  .object({
    kind: SosKind.default('SAFETY'),
    note: z.string().max(1000).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .openapi('SosRequest')
export type SosRequest = z.infer<typeof SosRequest>

export const SosAlertOut = z
  .object({
    id: z.string(),
    bookingId: z.string(),
    cleanerId: z.string(),
    kind: SosKind,
    note: z.string().nullable().default(null),
    lat: z.number().nullable().default(null),
    lng: z.number().nullable().default(null),
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).default('OPEN'),
    acknowledgedAt: z.number().int().nullable().default(null),
    acknowledgedBy: z.string().nullable().default(null),
    resolvedAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('SosAlertOut')
export type SosAlertOut = z.infer<typeof SosAlertOut>

// --- internal DB documents -------------------------------------------------

export interface JobSessionDoc {
  bookingId: string
  cleanerId: string
  status: JobSessionStatus
  enRouteAt?: number | null
  etaAt?: number | null
  startedAt: number
  completedAt?: number | null
  checklist: ChecklistTask[]
  payout?: number | null
  currency?: string | null
  dateCreated: number
  lastUpdated: number
}

export interface SosAlertDoc {
  bookingId: string
  cleanerId: string
  customerId: string
  kind: SosKind
  note?: string | null
  lat?: number | null
  lng?: number | null
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  acknowledgedAt?: number | null
  acknowledgedBy?: string | null
  resolvedAt?: number | null
  dateCreated: number
  lastUpdated: number
}

/**
 * Derive the elapsed WORKING duration. Never read from the client.
 * `startedAt` of 0 means the cleaner is only en route — no work time yet.
 */
export function durationOf(
  session: { startedAt: number; completedAt?: number | null },
  now: number,
): number {
  if (!session.startedAt) return 0
  return Math.max(0, (session.completedAt ?? now) - session.startedAt)
}
