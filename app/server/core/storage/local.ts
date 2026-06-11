import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { getSettings } from '@/server/core/settings'
import type { StorageProvider } from './provider'
import type { UploadIntent } from './types'

/**
 * Local-disk storage provider (DEV ONLY).
 *
 * Upload/read resolve to the hidden Hono routes
 * `POST /v1/documents/upload-local/{object_key}` and
 * `GET /v1/documents/local/{object_key}`, which call back into the helpers here.
 * On Vercel the function filesystem is ephemeral/read-only outside /tmp, so this
 * backend is for local development only (see settings.STORAGE_BACKEND).
 * See: docs/migration/11-infra-and-env.md (storage section)
 */

const ROUTE_PREFIX = '/api/v1/documents'

function localRoot(): string {
  return resolve(process.cwd(), getSettings().STORAGE_LOCAL_ROOT)
}

/** Resolve a key to an absolute path, guarding against path traversal. */
function pathForKey(key: string): string {
  const root = localRoot()
  const full = normalize(join(root, key))
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Invalid object key: ${key}`)
  }
  return full
}

export class LocalStorageProvider implements StorageProvider {
  readonly providerName = 'local'

  async createUploadIntent(args: { key: string; contentType: string }): Promise<UploadIntent> {
    return {
      key: args.key,
      uploadUrl: `${ROUTE_PREFIX}/upload-local/${encodeURIComponent(args.key)}`,
      method: 'POST',
      contentType: args.contentType,
    }
  }

  async getObjectUrl(key: string): Promise<string> {
    return `${ROUTE_PREFIX}/local/${encodeURIComponent(key)}`
  }

  async deleteObject(key: string): Promise<void> {
    await rm(pathForKey(key), { force: true })
  }
}

// --- helpers used by the hidden local upload/read routes (dev only) ---

/** Persist raw bytes for `key` on local disk; returns the stored size. */
export async function writeLocalObject(key: string, data: Uint8Array): Promise<number> {
  const path = pathForKey(key)
  await mkdir(dirname(path), { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, data)
  return data.byteLength
}

/** Read raw bytes for `key`; returns null if the object does not exist. */
export async function readLocalObject(key: string): Promise<Uint8Array | null> {
  const path = pathForKey(key)
  try {
    await stat(path)
  } catch {
    return null
  }
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}
