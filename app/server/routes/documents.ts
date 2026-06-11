import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import { getSettings } from '@/server/core/settings'
import { notFound } from '@/server/core/errors'
import {
  CompleteUploadRequest,
  DocumentOut,
  UploadIntentOut,
  UploadIntentRequest,
} from '@/server/schemas/document'
import * as documentService from '@/server/services/document-service'
import { readLocalObject, writeLocalObject } from '@/server/core/storage/local'

/**
 * /v1/documents — presigned upload intents + document metadata.
 * Mounted under /api/v1/documents (see server/app.ts). Customer-guarded.
 * The /upload-local and /local helpers are plain hidden routes (dev-only,
 * not in OpenAPI) used by the `local` storage backend.
 * See: docs/migration/07-domain-endpoints.md (/v1/documents)
 */

export const documents = createRouter()

const DocIdParam = z.object({
  document_id: z.string().min(1).openapi({ param: { name: 'document_id', in: 'path' } }),
})

const authErrs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// --- customer-guarded routes -------------------------------------------------
documents.use('/upload-intents', requireCustomer())
documents.use('/complete', requireCustomer())
documents.use('/:document_id', requireCustomer())

// POST /upload-intents
documents.openapi(
  createRoute({
    method: 'post',
    path: '/upload-intents',
    tags: ['Documents'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: UploadIntentRequest } } } },
    responses: {
      201: { description: 'Upload intent created', content: { 'application/json': { schema: envelopeOf(UploadIntentOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const intent = await documentService.createUploadIntent(p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Upload intent created successfully', intent), 201)
  },
)

// POST /complete
documents.openapi(
  createRoute({
    method: 'post',
    path: '/complete',
    tags: ['Documents'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: CompleteUploadRequest } } } },
    responses: {
      200: { description: 'Upload completed', content: { 'application/json': { schema: envelopeOf(DocumentOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const doc = await documentService.completeUpload(p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Upload completed successfully', doc), 200)
  },
)

// GET /{document_id}
documents.openapi(
  createRoute({
    method: 'get',
    path: '/{document_id}',
    tags: ['Documents'],
    security: [{ bearerAuth: [] }],
    request: { params: DocIdParam },
    responses: {
      200: { description: 'Document', content: { 'application/json': { schema: envelopeOf(DocumentOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const doc = await documentService.get(p.userId, c.req.valid('param').document_id)
    return c.json(ok(c, 'Document fetched successfully', doc), 200)
  },
)

// DELETE /{document_id}
documents.openapi(
  createRoute({
    method: 'delete',
    path: '/{document_id}',
    tags: ['Documents'],
    security: [{ bearerAuth: [] }],
    request: { params: DocIdParam },
    responses: {
      200: { description: 'Document deleted', content: { 'application/json': { schema: envelopeOf(z.object({ deleted: z.literal(true) })) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    await documentService.remove(p.userId, c.req.valid('param').document_id)
    return c.json(ok(c, 'Document deleted successfully', { deleted: true as const }), 200)
  },
)

// --- hidden local-backend helpers (dev only; NOT in OpenAPI) -----------------
// Registered as plain Hono routes so they don't appear in the spec. They only
// function when STORAGE_BACKEND=local; on other backends they return 404.

function ensureLocalBackend(): void {
  if (getSettings().STORAGE_BACKEND !== 'local') throw notFound('Local storage backend is not enabled')
}

documents.post('/upload-local/:object_key', async (c) => {
  ensureLocalBackend()
  const key = decodeURIComponent(c.req.param('object_key'))
  const body = new Uint8Array(await c.req.arrayBuffer())
  const size = await writeLocalObject(key, body)
  return c.json(ok(c, 'Object stored successfully', { key, size }), 201)
})

documents.get('/local/:object_key', async (c) => {
  ensureLocalBackend()
  const key = decodeURIComponent(c.req.param('object_key'))
  const data = await readLocalObject(key)
  if (!data) throw notFound('Object not found')
  // Copy into a standalone ArrayBuffer so the body type is a plain ArrayBuffer.
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  return c.body(buf, 200, { 'Content-Type': 'application/octet-stream' })
})
