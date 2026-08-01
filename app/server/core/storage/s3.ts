import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getSettings } from '@/server/core/settings'
import type { StorageProvider } from './provider'
import type { UploadIntent } from './types'

/**
 * S3 storage provider. Uses presigned PUT for uploads and presigned GET for
 * reads, so the client talks to S3 directly and the function never proxies
 * object bytes. Configured via S3_BUCKET_NAME / S3_REGION / S3_ENDPOINT_URL.
 * Setting S3_ENDPOINT_URL also switches on path-style addressing, which is what
 * S3-compatible backends (Cloudflare R2, MinIO) expect.
 *
 * Credential resolution order:
 *  1. `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` when BOTH are set — passed to
 *     the SDK explicitly. This is the path a non-AWS backend needs on Vercel:
 *     the Lambda runtime injects and owns the `AWS_*` names, so the default
 *     chain below cannot be pointed at (say) R2 keys.
 *  2. Otherwise no `credentials` property is passed at all, leaving the AWS
 *     SDK's default provider chain in charge (`AWS_*` env vars, shared config
 *     file, instance/IAM role...).
 *
 * Supplying exactly one half of the pair is rejected by settings validation
 * rather than silently degrading to (2). See server/core/settings.ts.
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
  const { S3_REGION, S3_ENDPOINT_URL, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = getSettings()
  cachedClient = new S3Client({
    region: S3_REGION ?? 'us-east-1',
    // A custom endpoint (e.g. MinIO / R2 / S3-compatible) needs path-style addressing.
    ...(S3_ENDPOINT_URL ? { endpoint: S3_ENDPOINT_URL, forcePathStyle: true } : {}),
    // Spread rather than `credentials: undefined`: the property must be ABSENT
    // when the keys are not configured, so the SDK's default provider chain
    // still runs. Settings validation guarantees these arrive as a pair.
    ...(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } }
      : {}),
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
