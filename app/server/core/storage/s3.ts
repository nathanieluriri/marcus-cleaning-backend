import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getSettings } from '@/server/core/settings'
import type { StorageProvider } from './provider'
import type { UploadIntent } from './types'

/**
 * S3 storage provider. Uses presigned PUT for uploads and presigned GET for
 * reads, so the client talks to S3 directly and the function never proxies
 * object bytes. Configured via S3_BUCKET_NAME / S3_REGION / S3_ENDPOINT_URL.
 * See: docs/migration/11-infra-and-env.md (storage section)
 */

const PRESIGN_EXPIRY_SECONDS = 60 * 15 // 15 minutes

let cachedClient: S3Client | null = null
let cachedBucket: string | null = null

function bucket(): string {
  if (cachedBucket) return cachedBucket
  const name = getSettings().S3_BUCKET_NAME
  if (!name) throw new Error('S3 storage backend requires S3_BUCKET_NAME')
  cachedBucket = name
  return name
}

function client(): S3Client {
  if (cachedClient) return cachedClient
  const { S3_REGION, S3_ENDPOINT_URL } = getSettings()
  cachedClient = new S3Client({
    region: S3_REGION ?? 'us-east-1',
    // A custom endpoint (e.g. MinIO / S3-compatible) needs path-style addressing.
    ...(S3_ENDPOINT_URL ? { endpoint: S3_ENDPOINT_URL, forcePathStyle: true } : {}),
  })
  return cachedClient
}

export class S3StorageProvider implements StorageProvider {
  readonly providerName = 's3'

  async createUploadIntent(args: { key: string; contentType: string }): Promise<UploadIntent> {
    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: args.key,
      ContentType: args.contentType,
    })
    const uploadUrl = await getSignedUrl(client(), command, { expiresIn: PRESIGN_EXPIRY_SECONDS })
    return { key: args.key, uploadUrl, method: 'PUT', contentType: args.contentType }
  }

  async getObjectUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket(), Key: key })
    return getSignedUrl(client(), command, { expiresIn: PRESIGN_EXPIRY_SECONDS })
  }

  async deleteObject(key: string): Promise<void> {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  }
}
