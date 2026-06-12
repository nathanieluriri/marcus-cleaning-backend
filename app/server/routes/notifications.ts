import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import {
  NotificationCreateRequest,
  NotificationUpdateRequest,
  NotificationOut,
} from '@/server/schemas/notification'
import * as notificationsService from '@/server/services/notifications-service'

/**
 * /v1/notifications — notification CRUD (collection `notifications`).
 * All routes are customer-guarded and scoped to the calling customer.
 * Mounted under /api/v1/notifications (see server/app.ts).
 * See: docs/migration/07-domain-endpoints.md
 */

export const notifications = createRouter()

const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }) })

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// Wildcard guard: `.use('/{id}', …)` never matches Hono's real `:id` route, so
// guard every path under this router instead. All notification routes are
// customer-scoped.
notifications.use('*', requireCustomer())

// GET /
notifications.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Notifications', content: { 'application/json': { schema: envelopeOf(z.array(NotificationOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await notificationsService.listNotifications({ principal: principalOf(c) })
    return c.json(ok(c, 'Notifications fetched successfully', items), 200)
  },
)

// POST /read-all
notifications.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'All marked read', content: { 'application/json': { schema: envelopeOf(z.object({ updated: z.number().int() })) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const result = await notificationsService.markAllRead({ principal: principalOf(c) })
    return c.json(ok(c, 'All notifications marked as read', result), 200)
  },
)

// POST /{id}/read — hybrid alias for the app's POST mark-read (PATCH /{id} still works)
notifications.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Notification marked read', content: { 'application/json': { schema: envelopeOf(NotificationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const notification = await notificationsService.updateNotification({
      principal: principalOf(c),
      id,
      payload: { read: true },
    })
    return c.json(ok(c, 'Notification marked as read', notification), 200)
  },
)

// POST /
notifications.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: NotificationCreateRequest } } } },
    responses: {
      201: { description: 'Notification created', content: { 'application/json': { schema: envelopeOf(NotificationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const payload = c.req.valid('json')
    const notification = await notificationsService.createNotification({ principal: principalOf(c), payload })
    return c.json(ok(c, 'Notification created successfully', notification), 201)
  },
)

// GET /{id}
notifications.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Notification', content: { 'application/json': { schema: envelopeOf(NotificationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const notification = await notificationsService.getNotification({ principal: principalOf(c), id })
    return c.json(ok(c, 'Notification fetched successfully', notification), 200)
  },
)

// PATCH /{id}
notifications.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: NotificationUpdateRequest } } } },
    responses: {
      200: { description: 'Notification updated', content: { 'application/json': { schema: envelopeOf(NotificationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const payload = c.req.valid('json')
    const notification = await notificationsService.updateNotification({ principal: principalOf(c), id, payload })
    return c.json(ok(c, 'Notification updated successfully', notification), 200)
  },
)

// DELETE /{id}
notifications.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Notification deleted', content: { 'application/json': { schema: envelopeOf(z.object({ id: z.string() })) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await notificationsService.deleteNotification({ principal: principalOf(c), id })
    return c.json(ok(c, 'Notification deleted successfully', { id }), 200)
  },
)
