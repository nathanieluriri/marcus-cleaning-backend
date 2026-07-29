import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext } from '@/server/core/http-env'
import { AppError, badRequest } from '@/server/core/errors'
import {
  requireCustomer,
  requireCleaner,
  requireCustomerOrCleaner,
  principalOf,
} from '@/server/security/guards'
import {
  loadViewableBooking,
  loadCustomerBooking,
  loadCleanerBooking,
} from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import { enrichBooking, enrichBookings } from '@/server/services/booking-enrichment'
import { computeQuote } from '@/server/services/pricing-service'
import { withIdempotency } from '@/server/core/idempotency'
import * as lifecycleService from '@/server/services/booking-lifecycle-service'
import { getProgress, progressFor } from '@/server/services/booking-progress-service'
import { BookingProgressOut } from '@/server/schemas/job-session'
import { notifyBookingParties } from '@/server/services/notification-dispatch'
import * as bookingRepo from '@/server/repositories/booking-repo'
import {
  BookingCancelRequest,
  BookingCancellationOut,
  BookingRescheduleRequest,
  BookingCustomerCreateRequest,
  resolveAddons,
  BookingListQuery,
  normalizeBookingListQuery,
  BookingListOut,
  BookingMarkPaidRequest,
  BookingQuoteRequest,
  BookingQuoteOut,
  BookingRatingRequest,
  BookingOut,
  type BookingDoc,
} from '@/server/schemas/booking'

/**
 * /v1/bookings — booking lifecycle.
 * Mounted under /api/v1/bookings (see server/app.ts).
 *
 * Layering note: the booking-service.ts module is owned by another in-progress
 * task and is intentionally NOT created here. Handlers orchestrate the repo +
 * state machine + access guards directly until that service lands.
 *
 * See: docs/migration/07-domain-endpoints.md
 */

export const bookings = createRouter()

const commonErrors = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const bookingIdParam = z.object({
  booking_id: z.string().openapi({ param: { name: 'booking_id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Server-authoritative price for a new booking. The client never supplies a
 * price; it is recomputed here from the same catalog the quote endpoint reads,
 * so a tampered or stale client total cannot be persisted.
 */
async function computePrice(
  payload: BookingCustomerCreateRequest,
): Promise<{ price: number | null; currency: string | null }> {
  const quote = await computeQuote(payload.serviceId, resolveAddons(payload), payload.hours ?? null)
  return { price: quote.total, currency: quote.currency }
}

/** Optional `Idempotency-Key` header, documented on the unsafe POSTs. */
const IdempotencyHeader = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(200)
    .optional()
    .openapi({
      // Key and param name must match (Hono lowercases incoming header names);
      // clients may still send the conventional `Idempotency-Key` casing.
      param: { name: 'idempotency-key', in: 'header', required: false },
      description: 'Retry-safe key. A repeat with the same key and body replays the original response.',
    }),
})

// --- guards (applied before the matching openapi() calls) ------------------
bookings.use('/', requireCustomerOrCleaner()) // covers POST + GET on '/' — POST re-checked below
bookings.use('/create', requireCustomerOrCleaner())
bookings.use('/quote', requireCustomer())
bookings.use('/:booking_id', requireCustomerOrCleaner())
bookings.use('/:booking_id/accept', requireCleaner())
bookings.use('/:booking_id/complete', requireCleaner())
bookings.use('/:booking_id/acknowledge', requireCustomer())
bookings.use('/:booking_id/payments/mark-paid', requireCustomer())
bookings.use('/:booking_id/ratings', requireCustomer())
bookings.use('/:booking_id/cancel', requireCustomerOrCleaner())
bookings.use('/:booking_id/reschedule', requireCustomerOrCleaner())
bookings.use('/:booking_id/progress', requireCustomerOrCleaner())

// POST / — create (customer only; customer id derived from the principal) ---
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } } },
  responses: {
    201: { description: 'Booking created', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    ...commonErrors,
  },
})

/** Shared create effect for `POST /` and its `POST /create` hybrid alias. */
async function createBookingFrom(c: AppContext, payload: BookingCustomerCreateRequest) {
  const principal = principalOf(c)
  // The shared guard allows cleaners through; creation is customer-only.
  if (principal.role !== 'customer') throw new AppError(403, 'AUTH_ROLE_MISMATCH', 'Role not permitted', { required: 'customer', actual: principal.role })

  // Idempotent under `Idempotency-Key`: a double tap or a retried request
  // replays the first booking instead of creating a second one.
  const result = await withIdempotency({
    scope: 'booking.create',
    key: c.req.header('Idempotency-Key'),
    actorId: principal.userId,
    body: payload,
    httpStatus: 201,
    operation: async () => {
      const ts = nowEpoch()
      const { price, currency } = await computePrice(payload)

      const doc: BookingDoc = {
        customer_id: principal.userId, // derived from token, NOT the request body
        cleaner_id: payload.cleanerId ?? null,
        serviceId: payload.serviceId,
        place_id: payload.placeId,
        status: 'PENDING',
        schedule: payload.schedule,
        addons: resolveAddons(payload),
        notes: payload.notes ?? null,
        hours: payload.hours ?? null,
        price,
        currency,
        payment_id: null,
        payment_status: 'UNPAID',
        rating: null,
        acceptedAt: null,
        completedAt: null,
        acknowledgedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        cancellationFee: null,
        rescheduleCount: 0,
        dateCreated: ts,
        lastUpdated: ts,
      }
      const created = await bookingRepo.createBooking(doc)
      const enriched = await enrichBooking(created)

      // Assigned up-front? Tell the cleaner. Pool jobs surface via the job feed.
      if (created.cleaner_id) {
        await notifyBookingParties({
          booking: created,
          actorRole: 'customer',
          title: 'New booking request',
          body: 'A customer has requested you for a cleaning.',
          type: 'booking.created',
        })
      }
      return enriched
    },
  })

  return c.json(ok(c, 'Booking created successfully', result.data), 201)
}

bookings.openapi(createRouteDef, async (c) => createBookingFrom(c, c.req.valid('json')))

// POST /create — hybrid alias of POST / for the app's guessed path (same effect).
const createAliasDef = createRoute({
  method: 'post',
  path: '/create',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } } },
  responses: {
    201: { description: 'Booking created', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    ...commonErrors,
  },
})
bookings.openapi(createAliasDef, async (c) => createBookingFrom(c, c.req.valid('json')))

// POST /quote — backend-authoritative price quote (customer) -----------------
const quoteRouteDef = createRoute({
  method: 'post',
  path: '/quote',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: BookingQuoteRequest } } } },
  responses: {
    200: { description: 'Price quote', content: { 'application/json': { schema: envelopeOf(BookingQuoteOut) } } },
    ...commonErrors,
  },
})
bookings.openapi(quoteRouteDef, async (c) => {
  const payload = c.req.valid('json')
  const quote = await computeQuote(
    payload.serviceId,
    payload.extras.map((addonId) => ({ addonId, quantity: 1 })),
    payload.hours ?? null,
  )
  return c.json(ok(c, 'Quote computed successfully', { ...quote, hours: payload.hours ?? null }), 200)
})

// GET / — list (customer or cleaner; scoped to the principal) ---------------
const listRouteDef = createRoute({
  method: 'get',
  path: '/',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { query: BookingListQuery },
  responses: {
    200: { description: 'Bookings', content: { 'application/json': { schema: envelopeOf(BookingListOut) } } },
    ...commonErrors,
  },
})

bookings.openapi(listRouteDef, async (c) => {
  const principal = principalOf(c)
  const q = normalizeBookingListQuery(c.req.valid('query'))

  const result = await bookingRepo.getBookingsHistory({
    customerId: principal.role === 'customer' ? principal.userId : undefined,
    cleanerId: principal.role === 'cleaner' ? principal.userId : undefined,
    status: q.status,
    paymentStatus: q.paymentStatus,
    scope: q.scope,
    scheduledSort: q.scheduledSort,
    cursor: q.cursor,
    pageSize: q.pageSize,
    now: nowEpoch(),
  })
  const items = await enrichBookings(result.items)
  return c.json(ok(c, 'Bookings retrieved successfully', { ...result, items }), 200)
})

// GET /{booking_id} — visibility-checked ------------------------------------
const getRouteDef = createRoute({
  method: 'get',
  path: '/{booking_id}',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam },
  responses: {
    200: { description: 'Booking', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(getRouteDef, async (c) => {
  const principal = principalOf(c)
  const { booking_id } = c.req.valid('param')
  const booking = await loadViewableBooking(principal, booking_id)
  const enriched = await enrichBooking(booking)
  // Single reads carry live progress so the details screen needs one call.
  return c.json(
    ok(c, 'Booking retrieved successfully', { ...enriched, progress: await progressFor(enriched) }),
    200,
  )
})

// GET /{booking_id}/progress — cheap poll for the "on the way" bar -----------
const progressRouteDef = createRoute({
  method: 'get',
  path: '/{booking_id}/progress',
  tags: ['Bookings'],
  summary: 'Live job progress for the customer-facing "cleaner is on the way" bar',
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam },
  responses: {
    200: { description: 'Progress', content: { 'application/json': { schema: envelopeOf(BookingProgressOut) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(progressRouteDef, async (c) => {
  const { booking_id } = c.req.valid('param')
  const progress = await getProgress({ principal: principalOf(c), bookingId: booking_id })
  return c.json(ok(c, 'Progress retrieved successfully', progress), 200)
})

// POST /{booking_id}/accept — cleaner ---------------------------------------
const acceptRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/accept',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam },
  responses: {
    200: { description: 'Booking accepted', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(acceptRouteDef, async (c) => {
  const principal = principalOf(c)
  const { booking_id } = c.req.valid('param')
  const booking = await loadCleanerBooking(principal, booking_id, { allowUnassigned: true })
  const status = applyTransition(booking.status, 'ACCEPTED')
  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    cleaner_id: principal.userId, // claim the booking
    acceptedAt: nowEpoch(),
    lastUpdated: nowEpoch(),
  })
  return c.json(ok(c, 'Booking accepted successfully', updated!), 200)
})

// POST /{booking_id}/complete — cleaner -------------------------------------
const completeRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/complete',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam },
  responses: {
    200: { description: 'Booking completed', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(completeRouteDef, async (c) => {
  const principal = principalOf(c)
  const { booking_id } = c.req.valid('param')
  const booking = await loadCleanerBooking(principal, booking_id)
  const status = applyTransition(booking.status, 'COMPLETED')
  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    completedAt: nowEpoch(),
    lastUpdated: nowEpoch(),
  })
  return c.json(ok(c, 'Booking completed successfully', updated!), 200)
})

// POST /{booking_id}/acknowledge — customer ---------------------------------
const acknowledgeRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/acknowledge',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam },
  responses: {
    200: { description: 'Booking acknowledged', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(acknowledgeRouteDef, async (c) => {
  const principal = principalOf(c)
  const { booking_id } = c.req.valid('param')
  const booking = await loadCustomerBooking(principal, booking_id)
  const status = applyTransition(booking.status, 'ACKNOWLEDGED')
  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    acknowledgedAt: nowEpoch(),
    lastUpdated: nowEpoch(),
  })
  return c.json(ok(c, 'Booking acknowledged successfully', updated!), 200)
})

// POST + PATCH /{booking_id}/payments/mark-paid — customer ------------------
function markPaidResponses() {
  return {
    200: { description: 'Booking marked paid', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Already paid', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  }
}

/** Shared mark-paid effect, used by both the POST and PATCH alias handlers. */
async function markPaid(c: AppContext, bookingId: string, paymentId: string) {
  const principal = principalOf(c)
  const booking = await loadCustomerBooking(principal, bookingId)
  if (booking.payment_status === 'PAID') throw badRequest('Booking is already paid')
  const updated = await bookingRepo.updateBooking(booking.id, {
    payment_id: paymentId,
    payment_status: 'PAID',
    lastUpdated: nowEpoch(),
  })
  return c.json(ok(c, 'Booking marked as paid successfully', updated!), 200)
}

const markPaidPostDef = createRoute({
  method: 'post',
  path: '/{booking_id}/payments/mark-paid',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam, body: { content: { 'application/json': { schema: BookingMarkPaidRequest } } } },
  responses: markPaidResponses(),
})
bookings.openapi(markPaidPostDef, async (c) => {
  const { booking_id } = c.req.valid('param')
  const { paymentId } = c.req.valid('json')
  return markPaid(c, booking_id, paymentId)
})

const markPaidPatchDef = createRoute({
  method: 'patch',
  path: '/{booking_id}/payments/mark-paid',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam, body: { content: { 'application/json': { schema: BookingMarkPaidRequest } } } },
  responses: markPaidResponses(),
})
bookings.openapi(markPaidPatchDef, async (c) => {
  const { booking_id } = c.req.valid('param')
  const { paymentId } = c.req.valid('json')
  return markPaid(c, booking_id, paymentId)
})

// POST /{booking_id}/ratings — customer -------------------------------------
const ratingRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/ratings',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam, body: { content: { 'application/json': { schema: BookingRatingRequest } } } },
  responses: {
    200: { description: 'Booking rated', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    400: { description: 'Cannot rate booking', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(ratingRouteDef, async (c) => {
  const principal = principalOf(c)
  const { booking_id } = c.req.valid('param')
  const payload = c.req.valid('json')
  const booking = await loadCustomerBooking(principal, booking_id)
  // Only completed/acknowledged bookings may be rated.
  if (booking.status !== 'COMPLETED' && booking.status !== 'ACKNOWLEDGED') {
    throw badRequest('Booking cannot be rated until it is completed')
  }
  const updated = await bookingRepo.updateBooking(booking.id, {
    rating: { rating: payload.rating, comment: payload.comment ?? null, ratedAt: nowEpoch() },
    lastUpdated: nowEpoch(),
  })
  return c.json(ok(c, 'Booking rated successfully', updated!), 200)
})

// POST /{booking_id}/cancel — customer or assigned cleaner --------------------
const cancelRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/cancel',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam, body: { content: { 'application/json': { schema: BookingCancelRequest } } } },
  responses: {
    200: { description: 'Booking cancelled', content: { 'application/json': { schema: envelopeOf(BookingCancellationOut) } } },
    400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(cancelRouteDef, async (c) => {
  const { booking_id } = c.req.valid('param')
  const payload = c.req.valid('json')
  const result = await lifecycleService.cancelBooking({
    principal: principalOf(c),
    bookingId: booking_id,
    reason: payload.reason ?? null,
  })
  return c.json(ok(c, 'Booking cancelled successfully', result), 200)
})

// POST /{booking_id}/reschedule — customer or assigned cleaner ---------------
const rescheduleRouteDef = createRoute({
  method: 'post',
  path: '/{booking_id}/reschedule',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { params: bookingIdParam, body: { content: { 'application/json': { schema: BookingRescheduleRequest } } } },
  responses: {
    200: { description: 'Booking rescheduled', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    400: { description: 'Cannot reschedule', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})

bookings.openapi(rescheduleRouteDef, async (c) => {
  const { booking_id } = c.req.valid('param')
  const payload = c.req.valid('json')
  const updated = await lifecycleService.rescheduleBooking({
    principal: principalOf(c),
    bookingId: booking_id,
    schedule: payload.schedule,
    reason: payload.reason ?? null,
  })
  return c.json(ok(c, 'Booking rescheduled successfully', updated), 200)
})
