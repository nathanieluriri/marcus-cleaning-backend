import type { UploadIntent } from './types'

/**
 * Pluggable object-storage backend (S3, local, or Vercel Blob).
 * Implementations live alongside this file and are selected by
 * `getStorageProvider()` in `manager.ts` from `settings.STORAGE_BACKEND`.
 * See: docs/migration/11-infra-and-env.md (storage section)
 */
export interface StorageProvider {
  /** Stable identifier for the backend ("s3" | "local" | "blob"). */
  readonly providerName: string

  /**
   * Produce upload instructions for a new object. The client performs the
   * actual upload (direct-to-storage for S3; via the hidden local route in dev).
   */
  createUploadIntent(args: { key: string; contentType: string }): Promise<UploadIntent>

  /** Presigned (or routable) GET URL to read the object back. */
  getObjectUrl(key: string): Promise<string>

  /** Remove the object. Idempotent — deleting a missing key must not throw. */
  deleteObject(key: string): Promise<void>
}
