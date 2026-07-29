import { z } from '@hono/zod-openapi'
import { AccountStatus, PreferredLanguage } from './customer'

/**
 * Admin domain schemas. Ported from `schemas/admin_schema.py`.
 * See: docs/migration/07-domain-endpoints.md
 */

export const AdminLogin = z
  .object({ email: z.email(), password: z.string().min(1) })
  .openapi('AdminLogin')
export type AdminLogin = z.infer<typeof AdminLogin>

export const AdminSignupRequest = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
  })
  .openapi('AdminSignupRequest')
export type AdminSignupRequest = z.infer<typeof AdminSignupRequest>

export const AdminOut = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.email(),
    accountStatus: AccountStatus.default('ACTIVE'),
    isSuperAdmin: z.boolean().default(false),
    permissionList: z.array(z.string()).default([]),
    preferredLanguage: PreferredLanguage.default('en'),
    accessPreset: z.string().nullable().default(null),
    mustChangePassword: z.boolean().default(false),
    totpEnabled: z.boolean().default(false),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('AdminOut')
export type AdminOut = z.infer<typeof AdminOut>

export interface AdminDoc {
  firstName: string
  lastName: string
  email: string
  password: string
  accountStatus: AccountStatus
  isSuperAdmin?: boolean
  permissionList?: string[] | null
  preferredLanguage: 'en' | 'fr'
  authProvider?: string | null
  authSubject?: string | null
  lastAuthAt?: number | null
  /** Named access preset applied to this admin (e.g. 'support', 'finance'); null when using raw permissionList only. */
  accessPreset?: string | null
  /** True when the admin must change their password before continuing (e.g. after invite/reset). */
  mustChangePassword?: boolean
  /** Epoch seconds after which a temporary password is no longer valid. */
  tempPasswordExpiresAt?: number | null
  /** Base32 TOTP secret, set once enrollment is confirmed. Never exposed via AdminOut. */
  totpSecret?: string | null
  /** Base32 TOTP secret awaiting confirmation (between /2fa/setup and /2fa/verify). */
  totpPendingSecret?: string | null
  /** Epoch seconds when TOTP was confirmed enabled; null/undefined means disabled. */
  totpEnabledAt?: number | null
  /** sha256 hashes of unused backup codes. Never exposed via AdminOut. */
  backupCodes?: string[]
  dateCreated: number
  lastUpdated: number
}
