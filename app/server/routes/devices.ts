import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomerOrCleaner, principalOf } from '@/server/security/guards'
import { DeviceRegisterRequest, DeviceOut } from '@/server/schemas/device'
import * as deviceService from '@/server/services/device-service'

/**
 * /v1/devices — push-token registration for both apps.
 * Mounted under /api/v1/devices (see server/app.ts).
 */

export const devices = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

devices.use('*', requireCustomerOrCleaner())

// POST / — register (or re-point) a push token
devices.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Devices'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: DeviceRegisterRequest } } } },
    responses: {
      201: { description: 'Device registered', content: { 'application/json': { schema: envelopeOf(DeviceOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const device = await deviceService.registerDevice({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Device registered successfully', device), 201)
  },
)

// GET / — the caller's registered devices
devices.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Devices'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Devices', content: { 'application/json': { schema: envelopeOf(z.array(DeviceOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await deviceService.listDevices(principalOf(c))
    return c.json(ok(c, 'Devices fetched successfully', items), 200)
  },
)

// DELETE /{id} — unregister (call on logout)
devices.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Devices'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Device removed', content: { 'application/json': { schema: envelopeOf(z.object({ deleted: z.boolean() })) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await deviceService.deleteDevice({ principal: principalOf(c), id })
    return c.json(ok(c, 'Device removed successfully', { deleted: true }), 200)
  },
)
