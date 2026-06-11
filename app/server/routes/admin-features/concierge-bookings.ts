import { createRoute } from '@hono/zod-openapi'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { ConciergeCreateBooking, FeatureOut } from '@/server/schemas/admin-features'
import { crudRouter } from './_crud'
import * as repo from '@/server/repositories/admin-features/_generic-repo'

/**
 * /concierge-bookings — CRUD over `concierge_booking` plus:
 *   POST `/create-booking` — admin creates a booking on a customer's behalf.
 *
 * TODO: delegate to the real booking creation flow (concierge-booking-service →
 * booking-service) once that domain lands. For now this records the concierge
 * booking request. See: docs/migration/06-services-and-repositories.md
 * See: docs/migration/07-domain-endpoints.md
 */

const COLL = 'concierge_booking'
const TAG = 'ConciergeBookings'

export const conciergeBookings = crudRouter({ collection: COLL, tag: TAG, noun: 'concierge booking' })

conciergeBookings.use('/create-booking', requireAdmin())
conciergeBookings.openapi(
  createRoute({
    method: 'post',
    path: '/create-booking',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: ConciergeCreateBooking } } } },
    responses: {
      201: { description: 'Concierge booking created', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const body = c.req.valid('json') as Record<string, unknown>
    const ts = Math.floor(Date.now() / 1000)
    const record = await repo.insertRaw(COLL, {
      ...body,
      status: 'CREATED',
      createdByAdmin: p.userId,
      dateCreated: ts,
      lastUpdated: ts,
    })
    return c.json(ok(c, 'Concierge booking created', FeatureOut.parse(record)), 201)
  },
)
