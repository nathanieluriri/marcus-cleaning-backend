import { createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { AppContext, Env } from '@/server/core/http-env'
import { authInvalidToken, AppError, badRequest } from '@/server/core/errors'
import { requireCustomer, requireCleaner, principalOf } from '@/server/security/guards'
import { verifyAccessToken } from '@/server/security/jwt'
import { ROLE_TO_AUDIENCE, type AuthPrincipal, type Role } from '@/server/security/principal'
import { retrieveAccountById } from '@/server/services/role-account-gateway'
import {
  loadViewableBooking,
  loadCustomerBooking,
  loadCleanerBooking,
} from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import * as bookingRepo from '@/server/repositories/booking-repo'
import {
  BookingCustomerCreateRequest,
  resolveAddons,
  BookingListQuery,
  normalizeBookingListQuery,
  BookingListOut,
  BookingMarkPaidRequest,
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
 * Pricing — STUB. The real computation lives in pricing-service (another task).
 * For now we passthrough a null price; payment-status drives paid state.
 */
function computePrice(_payload: BookingCustomerCreateRequest): { price: number | null; currency: string | null } {
  return { price: null, currency: null }
}

/**
 * Guard that accepts EITHER a customer or a cleaner access token (the shared
 * read endpoints `GET /` and `GET /{booking_id}`). Mirrors the role guards in
 * security/guards.ts but tries both audiences; visibility is then narrowed by
 * the booking-access helpers.
 */
function requireCustomerOrCleaner() {
  const candidates: Role[] = ['customer', 'cleaner']
  return createMiddleware<Env>(async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) throw authInvalidToken({ reason: 'Missing bearer token' })
    const token = authHeader.slice(7)

    let principal: AuthPrincipal | null = null
    let lastErr: unknown = null
    for (const role of candidates) {
      try {
        const claims = await verifyAccessToken(token, ROLE_TO_AUDIENCE[role])
        if (claims.role !== role) continue
        const account = await retrieveAccountById(role, claims.sub)
        if (!account) throw authInvalidToken({ reason: 'Account not found' })
        if (account.accountStatus !== 'ACTIVE') {
          throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Account is not active', {
            accountStatus: account.accountStatus,
          })
        }
        principal = { userId: claims.sub, role: claims.role, audience: claims.audience, sessionId: claims.sessionId }
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!principal) throw lastErr ?? authInvalidToken({ reason: 'Token not valid for customer or cleaner' })
    c.set('principal', principal)
    await next()
  })
}

// --- guards (applied before the matching openapi() calls) ------------------
bookings.use('/', requireCustomerOrCleaner()) // covers POST + GET on '/' — POST re-checked below
bookings.use('/create', requireCustomerOrCleaner())
bookings.use('/:booking_id', requireCustomerOrCleaner())
bookings.use('/:booking_id/accept', requireCleaner())
bookings.use('/:booking_id/complete', requireCleaner())
bookings.use('/:booking_id/acknowledge', requireCustomer())
bookings.use('/:booking_id/payments/mark-paid', requireCustomer())
bookings.use('/:booking_id/ratings', requireCustomer())

// POST / — create (customer only; customer id derived from the principal) ---
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } } },
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

  const ts = nowEpoch()
  const { price, currency } = computePrice(payload)

  const doc: BookingDoc = {
    customer_id: principal.userId, // derived from token, NOT the request body
    cleaner_id: payload.cleanerId ?? null,
    serviceId: payload.serviceId,
    place_id: payload.placeId,
    status: 'PENDING',
    schedule: payload.schedule,
    addons: resolveAddons(payload),
    notes: payload.notes ?? null,
    price,
    currency,
    payment_id: null,
    payment_status: 'UNPAID',
    rating: null,
    acceptedAt: null,
    completedAt: null,
    acknowledgedAt: null,
    dateCreated: ts,
    lastUpdated: ts,
  }
  const created = await bookingRepo.createBooking(doc)
  return c.json(ok(c, 'Booking created successfully', created), 201)
}

bookings.openapi(createRouteDef, async (c) => createBookingFrom(c, c.req.valid('json')))

// POST /create — hybrid alias of POST / for the app's guessed path (same effect).
const createAliasDef = createRoute({
  method: 'post',
  path: '/create',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } } },
  responses: {
    201: { description: 'Booking created', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    ...commonErrors,
  },
})
bookings.openapi(createAliasDef, async (c) => createBookingFrom(c, c.req.valid('json')))

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
  return c.json(ok(c, 'Bookings retrieved successfully', result), 200)
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
  return c.json(ok(c, 'Booking retrieved successfully', booking), 200)
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
