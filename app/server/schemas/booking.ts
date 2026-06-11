import { z } from '@hono/zod-openapi'

/**
 * Booking domain schemas (Zod + OpenAPI).
 * Ported from `schemas/booking_schema.py`.
 *
 * Status/payment-status are system-owned (see booking-state-machine.ts).
 * The list query reproduces the current API's dual snake_case/camelCase aliases
 * exactly so existing clients are unaffected.
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

// --- enums -----------------------------------------------------------------

/** Booking lifecycle: PENDING -> ACCEPTED -> COMPLETED -> ACKNOWLEDGED. */
export const BookingStatus = z.enum(['PENDING', 'ACCEPTED', 'COMPLETED', 'ACKNOWLEDGED', 'CANCELLED'])
export type BookingStatus = z.infer<typeof BookingStatus>

export const BookingPaymentStatus = z.enum(['UNPAID', 'PAID', 'REFUNDED', 'FAILED'])
export type BookingPaymentStatus = z.infer<typeof BookingPaymentStatus>

/** Whether `GET /` history scope looks at upcoming or past bookings. */
export const BookingHistoryScope = z.enum(['upcoming', 'past', 'all'])
export type BookingHistoryScope = z.infer<typeof BookingHistoryScope>

// --- requests --------------------------------------------------------------

/** Single add-on / extra attached to a booking. */
export const BookingAddon = z
  .object({
    addonId: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    quantity: z.number().int().min(1).default(1),
  })
  .openapi('BookingAddon')
export type BookingAddon = z.infer<typeof BookingAddon>

/**
 * Customer create-booking request. The customer id is derived from the
 * authenticated principal — it is intentionally NOT accepted in the body.
 */
export const BookingCustomerCreateRequest = z
  .object({
    cleanerId: z.string().nullable().optional().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    serviceId: z.string().openapi({ example: '665f1b2c9a1e4b0012service' }),
    placeId: z.string().openapi({ example: 'ChIJ...' }),
    /** Scheduled start time as a unix epoch (seconds). */
    schedule: z.number().int().openapi({ example: 1750000000 }),
    addons: z.array(BookingAddon).default([]),
    /** Legacy app alias: a flat list of add-on ids. Coalesced via resolveAddons(). */
    extras: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  })
  .openapi('BookingCustomerCreateRequest')
export type BookingCustomerCreateRequest = z.infer<typeof BookingCustomerCreateRequest>

/**
 * Coalesce the structured `addons` and the legacy flat `extras` id-list into the
 * canonical BookingAddon[]. Structured addons win; otherwise each extra id
 * becomes a quantity-1 add-on. See spec §5.3.
 */
export function resolveAddons(input: { addons?: BookingAddon[]; extras?: string[] }): BookingAddon[] {
  if (input.addons && input.addons.length > 0) return input.addons
  if (input.extras && input.extras.length > 0) return input.extras.map((addonId) => ({ addonId, quantity: 1 }))
  return []
}

/** Mark-paid request (POST + PATCH aliases). Payment id links to `payments`. */
export const BookingMarkPaidRequest = z
  .object({
    paymentId: z.string().openapi({ example: '665f1b2c9a1e4b0012payment' }),
  })
  .openapi('BookingMarkPaidRequest')
export type BookingMarkPaidRequest = z.infer<typeof BookingMarkPaidRequest>

/** Customer rating request. */
export const BookingRatingRequest = z
  .object({
    rating: z.number().min(1).max(5).openapi({ example: 5 }),
    comment: z.string().nullable().optional(),
  })
  .openapi('BookingRatingRequest')
export type BookingRatingRequest = z.infer<typeof BookingRatingRequest>

// --- list query (dual snake_case / camelCase aliases) ----------------------

/**
 * `GET /` query. Reproduces the current API's mixed conventions: every option
 * accepts BOTH a snake_case and a camelCase spelling, plus a combined `sort`
 * token (`scheduledAt_asc` / `scheduledAt_desc`). Coalesced into canonical
 * fields by the transform so the service/repo see one shape.
 */
export const BookingListQuery = z
  .object({
    status: BookingStatus.optional(),
    scope: BookingHistoryScope.optional(),
    payment_status: BookingPaymentStatus.optional(),
    paymentStatus: BookingPaymentStatus.optional(),
    cursor: z.string().optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    scheduled_sort: z.enum(['asc', 'desc']).optional(),
    scheduledSort: z.enum(['asc', 'desc']).optional(),
    sort: z.enum(['scheduledAt_asc', 'scheduledAt_desc']).optional(),
  })
  .openapi('BookingListQuery')
export type BookingListQuery = z.infer<typeof BookingListQuery>

/** Canonical, de-aliased list params after coalescing snake/camel spellings. */
export interface NormalizedBookingListQuery {
  status?: BookingStatus
  scope: BookingHistoryScope
  paymentStatus?: BookingPaymentStatus
  cursor?: string
  pageSize: number
  scheduledSort: 'asc' | 'desc'
}

/**
 * Coalesce the dual snake/camel query aliases into one canonical shape.
 * `sort` token wins, then explicit scheduled_sort/scheduledSort, default desc.
 */
export function normalizeBookingListQuery(q: BookingListQuery): NormalizedBookingListQuery {
  let scheduledSort: 'asc' | 'desc' = 'desc'
  if (q.sort === 'scheduledAt_asc') scheduledSort = 'asc'
  else if (q.sort === 'scheduledAt_desc') scheduledSort = 'desc'
  else if (q.scheduled_sort) scheduledSort = q.scheduled_sort
  else if (q.scheduledSort) scheduledSort = q.scheduledSort

  return {
    status: q.status,
    scope: q.scope ?? 'all',
    paymentStatus: q.payment_status ?? q.paymentStatus,
    cursor: q.cursor,
    pageSize: q.page_size ?? q.pageSize ?? 20,
    scheduledSort,
  }
}

// --- output ----------------------------------------------------------------

export const BookingRating = z
  .object({
    rating: z.number(),
    comment: z.string().nullable().default(null),
    ratedAt: z.number().int().nullable().default(null),
  })
  .openapi('BookingRating')
export type BookingRating = z.infer<typeof BookingRating>

/** Public booking view. Maps `_id` -> `id` at the repository boundary. */
export const BookingOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    customer_id: z.string(),
    cleaner_id: z.string().nullable().default(null),
    serviceId: z.string().nullable().default(null),
    place_id: z.string(),
    status: BookingStatus,
    schedule: z.number().int(),
    addons: z.array(BookingAddon).default([]),
    notes: z.string().nullable().default(null),
    price: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    payment_id: z.string().nullable().default(null),
    payment_status: BookingPaymentStatus.default('UNPAID'),
    rating: BookingRating.nullable().default(null),
    acceptedAt: z.number().int().nullable().default(null),
    completedAt: z.number().int().nullable().default(null),
    acknowledgedAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('BookingOut')
export type BookingOut = z.infer<typeof BookingOut>

/** Paginated list result for `GET /`. */
export const BookingListOut = z
  .object({
    items: z.array(BookingOut),
    nextCursor: z.string().nullable().default(null),
    pageSize: z.number().int(),
  })
  .openapi('BookingListOut')
export type BookingListOut = z.infer<typeof BookingListOut>

// --- internal DB document --------------------------------------------------

/** Internal DB document shape for the `bookings` collection. */
export interface BookingDoc {
  customer_id: string
  cleaner_id?: string | null
  serviceId?: string | null
  place_id: string
  status: BookingStatus
  schedule: number
  addons?: BookingAddon[]
  notes?: string | null
  price?: number | null
  currency?: string | null
  payment_id?: string | null
  payment_status: BookingPaymentStatus
  rating?: BookingRating | null
  acceptedAt?: number | null
  completedAt?: number | null
  acknowledgedAt?: number | null
  /** Cleaner ids who have passed on this (still-unassigned) job. */
  declinedBy?: string[] | null
  dateCreated: number
  lastUpdated: number
}
