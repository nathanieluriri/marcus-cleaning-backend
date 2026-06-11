/**
 * Storage primitives shared by every StorageProvider.
 * Ported from the Python `storage/*` provider abstraction.
 * See: docs/migration/11-infra-and-env.md (storage section)
 */

/**
 * Instructions a client uses to upload an object directly to the backend.
 * For S3 this is a presigned POST (URL + form fields); for the local backend
 * it points at the hidden `/v1/documents/upload-local/{object_key}` route.
 */
export interface UploadIntent {
  /** Storage key (path) the object will be stored under. */
  key: string
  /** Absolute or relative URL the client uploads to. */
  uploadUrl: string
  /** HTTP method the client should use for the upload. */
  method: 'POST' | 'PUT'
  /** Extra form fields to include (presigned-POST policy fields), if any. */
  fields?: Record<string, string>
  /** Content type the upload must use. */
  contentType: string
}

/** Metadata describing a stored object, returned after an upload completes. */
export interface StoredObject {
  key: string
  contentType: string
  size?: number | null
}
