import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerSelfProfileOut, CleanerProfileUpdateRequest } from '@/server/schemas/cleaner-job'
import * as profileService from '@/server/services/cleaner-profile-service'
import * as settingsService from '@/server/services/cleaner-settings-service'

/** /v1/cleaner/profile — cleaner self profile read + update. Mounted at /api/v1/cleaner. */
export const cleanerProfile = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

cleanerProfile.use('/profile', requireCleaner())
cleanerProfile.use('/settings', requireCleaner())
cleanerProfile.use('/settings/*', requireCleaner())

const NotificationsBody = z
  .object({
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    marketing: z.boolean().optional(),
  })
  .openapi('CleanerNotificationPrefs')

const SettingsData = z.record(z.string(), z.unknown()).openapi('CleanerSettings')

cleanerProfile.openapi(
  createRoute({
    method: 'get',
    path: '/profile',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Profile', content: { 'application/json': { schema: envelopeOf(CleanerSelfProfileOut) } } },
      401: errs[401],
      404: errs[404],
    },
  }),
  async (c) => {
    const profile = await profileService.getSelf(principalOf(c))
    return c.json(ok(c, 'Profile fetched successfully', profile), 200)
  },
)

cleanerProfile.openapi(
  createRoute({
    method: 'patch',
    path: '/profile',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: CleanerProfileUpdateRequest } } } },
    responses: {
      200: { description: 'Profile updated', content: { 'application/json': { schema: envelopeOf(CleanerSelfProfileOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const profile = await profileService.updateSelf(principalOf(c), c.req.valid('json'))
    return c.json(ok(c, 'Profile updated successfully', profile), 200)
  },
)

cleanerProfile.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Settings', content: { 'application/json': { schema: envelopeOf(SettingsData) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const settings = await settingsService.getSettings(p.userId)
    return c.json(ok(c, 'Settings retrieved successfully', settings), 200)
  },
)

cleanerProfile.openapi(
  createRoute({
    method: 'patch',
    path: '/settings/notifications',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: NotificationsBody } } } },
    responses: {
      200: { description: 'Settings updated', content: { 'application/json': { schema: envelopeOf(SettingsData) } } },
      ...errs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const patch = c.req.valid('json') as Record<string, unknown>
    const settings = await settingsService.patchNotifications(p.userId, patch)
    return c.json(ok(c, 'Settings updated successfully', settings), 200)
  },
)
