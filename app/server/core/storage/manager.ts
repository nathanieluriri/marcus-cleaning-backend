import { getSettings } from '@/server/core/settings'
import type { StorageProvider } from './provider'
import { S3StorageProvider } from './s3'
import { LocalStorageProvider } from './local'

/**
 * Resolve the active StorageProvider from settings.STORAGE_BACKEND.
 * The instance is module-cached so the provider (and its SDK client) is reused
 * across warm invocations. The `blob` backend is documented but not yet
 * implemented; it falls back to S3-style behavior would require a blob.ts.
 * See: docs/migration/11-infra-and-env.md (storage section)
 */

let cached: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (cached) return cached
  const backend = getSettings().STORAGE_BACKEND
  switch (backend) {
    case 'local':
      cached = new LocalStorageProvider()
      break
    case 's3':
      cached = new S3StorageProvider()
      break
    case 'blob':
      // STUB: a dedicated Vercel Blob provider (blob.ts) is out of scope here;
      // S3 is the production backend. Fail loudly rather than silently mis-store.
      throw new Error('STORAGE_BACKEND=blob is not yet implemented; use s3 or local')
    default:
      throw new Error(`Unknown STORAGE_BACKEND: ${String(backend)}`)
  }
  return cached
}

/** Test helper — reset the cached provider. */
export function __resetStorageProviderCache(): void {
  cached = null
}
