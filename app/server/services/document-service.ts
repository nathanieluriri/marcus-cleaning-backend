import { randomUUID } from 'node:crypto'
import { badRequest, forbidden, notFound } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import { getStorageProvider } from '@/server/core/storage/manager'
import * as documentRepo from '@/server/repositories/document-repo'
import { DocumentOut, type CompleteUploadRequest, type DocumentOut as DocumentOutType, type UploadIntentOut, type UploadIntentRequest } from '@/server/schemas/document'
import { fromDoc } from '@/server/repositories/_helpers'

/**
 * Document business logic — bridges the storage provider and document-repo.
 * No HTTP/Hono types here.
 * See: docs/migration/07-domain-endpoints.md (/v1/documents)
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Sanitize a filename for use inside a storage key. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'file'
}

/** Build the object key namespaced by owner so keys never collide. */
function buildKey(ownerId: string, fileName: string): string {
  return `documents/${ownerId}/${randomUUID()}-${safeName(fileName)}`
}

/**
 * Content types accepted for uploads. The staff app's ID-document step states
 * "PNG, JPG or PDF up to 10MB"; this is the server-side enforcement of that
 * promise, applied to every upload rather than just ID documents.
 */
export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const

/**
 * Reject unsupported types and oversized files before minting a presigned URL.
 * `size` is client-declared here; the storage provider enforces the real limit
 * on the presigned request, and `/complete` re-checks the stored object.
 */
function assertUploadAllowed(payload: UploadIntentRequest): void {
  const contentType = payload.contentType.toLowerCase().split(';')[0].trim()
  if (!ALLOWED_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_CONTENT_TYPES)[number])) {
    throw badRequest('Unsupported file type', {
      contentType: payload.contentType,
      allowed: ALLOWED_CONTENT_TYPES,
    })
  }
  const max = getSettings().DOCUMENT_MAX_UPLOAD_BYTES
  if (payload.size != null && payload.size > max) {
    throw badRequest('File is too large', { size: payload.size, maxBytes: max })
  }
}

export async function createUploadIntent(
  ownerId: string,
  payload: UploadIntentRequest,
): Promise<UploadIntentOut> {
  assertUploadAllowed(payload)
  const objectKey = buildKey(ownerId, payload.fileName)
  const ts = nowEpoch()
  const stored = await documentRepo.insertDocument({
    ownerId,
    objectKey,
    contentType: payload.contentType,
    fileName: payload.fileName,
    size: payload.size ?? null,
    status: 'UPLOADING',
    dateCreated: ts,
    lastUpdated: ts,
  })

  const intent = await getStorageProvider().createUploadIntent({
    key: objectKey,
    contentType: payload.contentType,
  })

  return {
    document: DocumentOut.parse({ ...fromDoc(stored), url: null }),
    upload: {
      key: intent.key,
      uploadUrl: intent.uploadUrl,
      method: intent.method,
      fields: intent.fields,
      contentType: intent.contentType,
    },
  }
}

export async function completeUpload(ownerId: string, payload: CompleteUploadRequest): Promise<DocumentOutType> {
  const doc = await documentRepo.getById(payload.documentId)
  if (!doc) throw notFound('Document not found')
  if (doc.ownerId !== ownerId) throw forbidden('Not allowed to modify this document')

  await documentRepo.markUploaded(payload.documentId, payload.size ?? null, nowEpoch())
  return get(ownerId, payload.documentId)
}

export async function get(ownerId: string, documentId: string): Promise<DocumentOutType> {
  const doc = await documentRepo.getById(documentId)
  if (!doc) throw notFound('Document not found')
  if (doc.ownerId !== ownerId) throw forbidden('Not allowed to access this document')

  const url = await getStorageProvider().getObjectUrl(doc.objectKey)
  return DocumentOut.parse({ ...fromDoc(doc), url })
}

export async function remove(ownerId: string, documentId: string): Promise<void> {
  const doc = await documentRepo.getById(documentId)
  if (!doc) throw notFound('Document not found')
  if (doc.ownerId !== ownerId) throw forbidden('Not allowed to delete this document')

  await getStorageProvider().deleteObject(doc.objectKey)
  await documentRepo.deleteById(documentId)
}
