import { z } from '@hono/zod-openapi'
import { AvailabilityWindow, DayOfWeek } from './cleaner-application'
import { CleanerJobOut } from './cleaner-job'

/**
 * Cleaner availability and schedule.
 *
 * Availability is BOTH a recurring weekly pattern and a set of concrete
 * date-scoped overrides — the app needs the weekly rule for the settings screen
 * and the overrides for "I'm away next Tuesday". The weekly pattern lives on
 * the cleaner's availability document; overrides are separate dated entries
 * that win over the pattern for the day they name.
 */

export { AvailabilityWindow, DayOfWeek }

/** A dated exception to the weekly pattern. */
export const AvailabilityOverride = z
  .object({
    /** ISO date, YYYY-MM-DD, in the cleaner's service area. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-08-14' }),
    /** false = unavailable all day; true = available during `windows`. */
    available: z.boolean().default(false),
    windows: z.array(z.object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })).default([]),
    note: z.string().max(280).nullable().default(null),
  })
  .openapi('AvailabilityOverride')
export type AvailabilityOverride = z.infer<typeof AvailabilityOverride>

export const AvailabilityOut = z
  .object({
    cleanerId: z.string(),
    /** Recurring weekly pattern. */
    weekly: z.array(AvailabilityWindow).default([]),
    overrides: z.array(AvailabilityOverride).default([]),
    /** IANA timezone the local times are interpreted in. */
    timezone: z.string().default('UTC').openapi({ example: 'America/New_York' }),
    /** Paused cleaners keep their pattern but receive no job offers. */
    acceptingJobs: z.boolean().default(true),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('AvailabilityOut')
export type AvailabilityOut = z.infer<typeof AvailabilityOut>

export const AvailabilityUpdateRequest = z
  .object({
    weekly: z.array(AvailabilityWindow).optional(),
    overrides: z.array(AvailabilityOverride).optional(),
    timezone: z.string().optional(),
    acceptingJobs: z.boolean().optional(),
  })
  .openapi('AvailabilityUpdateRequest')
export type AvailabilityUpdateRequest = z.infer<typeof AvailabilityUpdateRequest>

// --- schedule ---------------------------------------------------------------

export const ScheduleQuery = z
  .object({
    /** Inclusive window start, unix epoch seconds. Defaults to today. */
    from: z.coerce.number().int().optional(),
    /** Exclusive window end, unix epoch seconds. Defaults to from + 30 days. */
    to: z.coerce.number().int().optional(),
  })
  .openapi('ScheduleQuery')
export type ScheduleQuery = z.infer<typeof ScheduleQuery>

export const ScheduleDay = z
  .object({
    /** UTC midnight of the day, unix epoch seconds. */
    date: z.number().int(),
    jobs: z.array(CleanerJobOut).default([]),
    /** Sum of the day's job prices, in major units. */
    earnings: z.number().default(0),
  })
  .openapi('ScheduleDay')
export type ScheduleDay = z.infer<typeof ScheduleDay>

export const ScheduleOut = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
    days: z.array(ScheduleDay).default([]),
  })
  .openapi('ScheduleOut')
export type ScheduleOut = z.infer<typeof ScheduleOut>

// --- today's dashboard ------------------------------------------------------

export const TodayStatsOut = z
  .object({
    earnedToday: z.number(),
    hoursToday: z.number(),
    jobsToday: z.number().int(),
    rating: z.number(),
    currency: z.string().nullable().default(null),
  })
  .openapi('TodayStatsOut')
export type TodayStatsOut = z.infer<typeof TodayStatsOut>

export const TodayOut = z
  .object({
    stats: TodayStatsOut,
    /** The next job that has not started yet, if any. */
    nextJob: CleanerJobOut.nullable().default(null),
    jobs: z.array(CleanerJobOut).default([]),
  })
  .openapi('TodayOut')
export type TodayOut = z.infer<typeof TodayOut>

/** Internal DB document shape for the `cleaner_availability` collection. */
export interface AvailabilityDoc {
  cleanerId: string
  weekly: Array<z.infer<typeof AvailabilityWindow>>
  overrides: AvailabilityOverride[]
  timezone: string
  acceptingJobs: boolean
  dateCreated: number
  lastUpdated: number
}
