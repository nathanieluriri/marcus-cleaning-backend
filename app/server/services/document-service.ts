import { randomUUID } from 'node:crypto'
import { forbidden, notFound } from '@/server/core/errors'
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

export async function createUploadIntent(
  ownerId: string,
  payload: UploadIntentRequest,
): Promise<UploadIntentOut> {
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
