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

export const JobSessionStatus = z.enum(['IN_PROGRESS', 'COMPLETED'])
export type JobSessionStatus = z.infer<typeof JobSessionStatus>

export const JobSessionOut = z
  .object({
    id: z.string(),
    bookingId: z.string(),
    cleanerId: z.string(),
    status: JobSessionStatus,
    /** Authoritative start, unix epoch seconds. Set by the server, not the app. */
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

/** Derive the elapsed duration for a session. Never read from the client. */
export function durationOf(session: { startedAt: number; completedAt?: number | null }, now: number): number {
  return Math.max(0, (session.completedAt ?? now) - session.startedAt)
}
