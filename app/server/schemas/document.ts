import { z } from '@hono/zod-openapi'

/**
 * Document domain schemas (Zod + OpenAPI).
 * Backs /v1/documents — presigned upload intents + metadata records.
 * See: docs/migration/07-domain-endpoints.md (/v1/documents)
 */

// --- output ------------------------------------------------------------------

export const DocumentOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    ownerId: z.string(),
    objectKey: z.string().openapi({ example: 'documents/665f.../avatar.png' }),
    contentType: z.string().openapi({ example: 'image/png' }),
    fileName: z.string().nullable().default(null),
    size: z.number().int().nullable().default(null),
    /** UPLOADING until the client confirms via /complete, then UPLOADED. */
    status: z.enum(['UPLOADING', 'UPLOADED']).default('UPLOADING'),
    /** Presigned GET URL — populated on read, not stored. */
    url: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('DocumentOut')
export type DocumentOut = z.infer<typeof DocumentOut>

// --- requests ----------------------------------------------------------------

export const UploadIntentRequest = z
  .object({
    fileName: z.string().min(1).openapi({ example: 'avatar.png' }),
    contentType: z.string().min(1).openapi({ example: 'image/png' }),
    size: z.number().int().positive().optional(),
  })
  .openapi('UploadIntentRequest')
export type UploadIntentRequest = z.infer<typeof UploadIntentRequest>

export const UploadIntentOut = z
  .object({
    document: DocumentOut,
    upload: z.object({
      key: z.string(),
      uploadUrl: z.string(),
      method: z.enum(['POST', 'PUT']),
      fields: z.record(z.string(), z.string()).optional(),
      contentType: z.string(),
    }),
  })
  .openapi('UploadIntentOut')
export type UploadIntentOut = z.infer<typeof UploadIntentOut>

export const CompleteUploadRequest = z
  .object({
    documentId: z.string().min(1).openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    size: z.number().int().positive().optional(),
  })
  .openapi('CompleteUploadRequest')
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequest>

/** Internal DB document shape for the `documents` collection. */
export interface DocumentDoc {
  ownerId: string
  objectKey: string
  contentType: string
  fileName?: string | null
  size?: number | null
  status: 'UPLOADING' | 'UPLOADED'
  dateCreated: number
  lastUpdated: number
}
