import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerSelfProfileOut, CleanerProfileUpdateRequest } from '@/server/schemas/cleaner-job'
import * as profileService from '@/server/services/cleaner-profile-service'

/** /v1/cleaner/profile — cleaner self profile read + update. Mounted at /api/v1/cleaner. */
export const cleanerProfile = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

cleanerProfile.use('/profile', requireCleaner())

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
