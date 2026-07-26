import { z } from '@hono/zod-openapi'
import { BookingStatus, type BookingOut } from './booking'

/**
 * Cleaner-app "job" surface. The backend models this work as `bookings`; these
 * schemas + the pure `mapBookingToCleanerJob` adapter translate a BookingOut
 * into the CleanerJob shape the app expects. Fields with no backing data
 * (distanceMiles, isPriority) are stubbed — see spec §7.
 */

export const CleanerJobOut = z
  .object({
    id: z.string(),
    title: z.string(),
    clientName: z.string(),
    scheduledAt: z.number().int().nullable().default(null),
    address: z.string().nullable().default(null),
    price: z.number().nullable().default(null),
    distanceMiles: z.number().nullable().default(null),
    status: BookingStatus,
    notes: z.string().nullable().default(null),
    isPriority: z.boolean().default(false),
  })
  .openapi('CleanerJobOut')
export type CleanerJobOut = z.infer<typeof CleanerJobOut>

/**
 * `GET /v1/cleaner/jobs` query.
 *
 * `scope` splits the Available Jobs tab from My Jobs:
 *   available — unassigned pool jobs the cleaner could accept
 *   assigned  — jobs already claimed by this cleaner
 *   all       — both (the default, preserving the previous behaviour)
 *
 * Distance is only computable when the caller supplies coordinates OR has a
 * service area configured; `radiusMiles` without either is ignored rather than
 * silently returning nothing.
 */
export const CleanerJobListQuery = z
  .object({
    scope: z.enum(['available', 'assigned', 'all']).default('all'),
    status: BookingStatus.optional(),
    /** Caller's current position, used for distance + radius filtering. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    /** Only return jobs within this many miles of `lat`/`lng`. */
    radiusMiles: z.coerce.number().min(0).max(200).optional(),
    /** Restrict to jobs scheduled at/after this unix epoch. */
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    sort: z.enum(['schedule', 'distance']).default('schedule'),
  })
  .openapi('CleanerJobListQuery')
export type CleanerJobListQuery = z.infer<typeof CleanerJobListQuery>

export const CleanerJobDeclineRequest = z
  .object({ reason: z.string().nullable().optional() })
  .openapi('CleanerJobDeclineRequest')
export type CleanerJobDeclineRequest = z.infer<typeof CleanerJobDeclineRequest>

export const CleanerSelfProfileOut = z
  .object({
    id: z.string(),
    fullName: z.string(),
    email: z.email(),
    phone: z.string().nullable().default(null),
    bio: z.string().nullable().default(null),
    rating: z.number().default(0),
    reviewsCount: z.number().int().default(0),
    completedJobs: z.number().int().default(0),
    serviceRadiusMiles: z.number().nullable().default(null),
    services: z.array(z.string()).default([]),
    availableDays: z.array(z.string()).default([]),
    avatarUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerSelfProfileOut')
export type CleanerSelfProfileOut = z.infer<typeof CleanerSelfProfileOut>

export const CleanerProfileUpdateRequest = z
  .object({
    fullName: z.string().min(1).optional(),
    email: z.email().optional(),
    phone: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    serviceRadiusMiles: z.number().min(0).nullable().optional(),
    services: z.array(z.string()).optional(),
    availableDays: z.array(z.string()).optional(),
  })
  .openapi('CleanerProfileUpdateRequest')
export type CleanerProfileUpdateRequest = z.infer<typeof CleanerProfileUpdateRequest>

// --- pure adapters (unit-tested) -------------------------------------------

export interface CleanerJobContext {
  title: string
  clientName: string
  address: string | null
}

/** Translate a BookingOut + resolved context into the CleanerJob shape. */
export function mapBookingToCleanerJob(b: BookingOut, ctx: CleanerJobContext): CleanerJobOut {
  return {
    id: b.id,
    title: ctx.title,
    clientName: ctx.clientName,
    scheduledAt: b.schedule,
    address: ctx.address ?? b.place_id,
    price: b.price,
    distanceMiles: null,
    status: b.status,
    notes: b.notes,
    isPriority: false,
  }
}

/** Split a single display name into firstName (first token) + lastName (remainder). */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts.shift() ?? ''
  return { firstName, lastName: parts.join(' ') }
}
