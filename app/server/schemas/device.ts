import { z } from '@hono/zod-openapi'

/**
 * Push-device registration (`devices` collection).
 *
 * One document per (token) — a token uniquely identifies an app install, so
 * re-registering the same token re-points it at the current user rather than
 * creating a duplicate (this is how a device is handed between accounts on
 * logout/login).
 *
 * See: docs/migration/10-background-and-cron.md
 */

export const DevicePlatform = z.enum(['ios', 'android', 'web'])
export type DevicePlatform = z.infer<typeof DevicePlatform>

export const DeviceRegisterRequest = z
  .object({
    token: z.string().min(1).openapi({ example: 'fcm-registration-token', description: 'FCM registration token (APNs devices register through FCM).' }),
    platform: DevicePlatform,
    /** Stable per-install id, so a reinstall does not strand the old row. */
    deviceId: z.string().nullable().optional().openapi({ example: 'A1B2C3-D4E5' }),
    appVersion: z.string().nullable().optional().openapi({ example: '1.4.0' }),
    locale: z.string().nullable().optional().openapi({ example: 'en' }),
  })
  .openapi('DeviceRegisterRequest')
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequest>

export const DeviceOut = z
  .object({
    id: z.string(),
    userId: z.string(),
    role: z.enum(['customer', 'cleaner']),
    token: z.string(),
    platform: DevicePlatform,
    deviceId: z.string().nullable().default(null),
    appVersion: z.string().nullable().default(null),
    locale: z.string().nullable().default(null),
    /** Set when the push provider reports the token as permanently invalid. */
    disabledAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('DeviceOut')
export type DeviceOut = z.infer<typeof DeviceOut>

/** Internal DB document shape for the `devices` collection. */
export interface DeviceDoc {
  userId: string
  role: 'customer' | 'cleaner'
  token: string
  platform: DevicePlatform
  deviceId?: string | null
  appVersion?: string | null
  locale?: string | null
  disabledAt?: number | null
  dateCreated: number
  lastUpdated: number
}
