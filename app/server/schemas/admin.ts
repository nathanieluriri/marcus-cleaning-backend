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
  dateCreated: number
  lastUpdated: number
}
