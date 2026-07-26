import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import {
  ApplicationDocumentAttachRequest,
  ApplicationOut,
  ApplicationUpsertRequest,
} from '@/server/schemas/cleaner-application'
import { ALLOWED_CONTENT_TYPES } from '@/server/services/document-service'
import { getSettings } from '@/server/core/settings'
import * as applicationService from '@/server/services/cleaner-application-service'

/**
 * /v1/cleaner/applications — the staff app's onboarding wizard.
 * Mounted under /api/v1/cleaner (see server/app.ts).
 *
 * Documents are uploaded directly to storage with a presigned URL from
 * /v1/documents/upload-intents; this router only records the reference.
 * Admin review lives at /v1/admins/applications (routes/admin-core.ts).
 */

export const cleanerApplications = createRouter()

const errs = {
  400: { description: 'Invalid for the current state', content: { 'application/json': { schema: ErrorEnvelope } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

const UploadRulesOut = z
  .object({
    allowedContentTypes: z.array(z.string()),
    maxBytes: z.number().int(),
    /** Presigned direct-to-storage; the app never posts bytes to this API. */
    mechanism: z.literal('presigned-url'),
    intentPath: z.string(),
    completePath: z.string(),
  })
  .openapi('ApplicationUploadRules')

cleanerApplications.use('/applications', requireCleaner())
cleanerApplications.use('/applications/*', requireCleaner())

// GET /applications — the caller's application (creates an empty draft if none)
cleanerApplications.openapi(
  createRoute({
    method: 'get',
    path: '/applications',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Application', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const app = await applicationService.getMyApplication(principalOf(c))
    return c.json(ok(c, 'Application fetched successfully', app), 200)
  },
)

// POST /applications — create or patch the draft as the wizard progresses
cleanerApplications.openapi(
  createRoute({
    method: 'post',
    path: '/applications',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: ApplicationUpsertRequest } } } },
    responses: {
      200: { description: 'Application saved', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const app = await applicationService.upsertApplication({
      principal: principalOf(c),
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Application saved successfully', app), 200)
  },
)

// GET /applications/upload-rules — accepted types + size, so the UI copy matches
cleanerApplications.openapi(
  createRoute({
    method: 'get',
    path: '/applications/upload-rules',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Upload rules', content: { 'application/json': { schema: envelopeOf(UploadRulesOut) } } },
      401: errs[401],
    },
  }),
  async (c) =>
    c.json(
      ok(c, 'Upload rules fetched successfully', {
        allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
        maxBytes: getSettings().DOCUMENT_MAX_UPLOAD_BYTES,
        mechanism: 'presigned-url' as const,
        intentPath: '/api/v1/documents/upload-intents',
        completePath: '/api/v1/documents/complete',
      }),
      200,
    ),
)

// GET /applications/{id}
cleanerApplications.openapi(
  createRoute({
    method: 'get',
    path: '/applications/{id}',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Application', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const app = await applicationService.getApplication(principalOf(c), id)
    return c.json(ok(c, 'Application fetched successfully', app), 200)
  },
)

// PATCH /applications/{id}
cleanerApplications.openapi(
  createRoute({
    method: 'patch',
    path: '/applications/{id}',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ApplicationUpsertRequest } } } },
    responses: {
      200: { description: 'Application saved', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const app = await applicationService.upsertApplication({
      principal: principalOf(c),
      id,
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Application saved successfully', app), 200)
  },
)

// POST /applications/{id}/documents — record an uploaded document
cleanerApplications.openapi(
  createRoute({
    method: 'post',
    path: '/applications/{id}/documents',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ApplicationDocumentAttachRequest } } },
    },
    responses: {
      200: { description: 'Document attached', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const app = await applicationService.attachDocument({
      principal: principalOf(c),
      id,
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Document attached successfully', app), 200)
  },
)

// POST /applications/{id}/submit
cleanerApplications.openapi(
  createRoute({
    method: 'post',
    path: '/applications/{id}/submit',
    tags: ['Cleaner Applications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Application submitted', content: { 'application/json': { schema: envelopeOf(ApplicationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const app = await applicationService.submitApplication({ principal: principalOf(c), id })
    return c.json(ok(c, 'Application submitted successfully', app), 200)
  },
)
