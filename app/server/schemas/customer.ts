import { z } from '@hono/zod-openapi'

/**
 * Customer domain schemas (Zod + OpenAPI).
 * Ported from `schemas/customer_schema.py`.
 *
 * See: docs/migration/07-domain-endpoints.md
 */

export const AccountStatus = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED'])
export type AccountStatus = z.infer<typeof AccountStatus>

export const LoginType = z.enum(['email', 'google'])
export type LoginType = z.infer<typeof LoginType>

export const PreferredLanguage = z.enum(['en', 'fr'])

export const CustomerSignupRequest = z
  .object({
    firstName: z.string().min(1).openapi({ example: 'Ada' }),
    lastName: z.string().min(1).openapi({ example: 'Lovelace' }),
    email: z.email().openapi({ example: 'ada@example.com' }),
    password: z.string().min(8).openapi({ example: 'sup3r-secret' }),
    phoneNumber: z.string().optional(),
  })
  .openapi('CustomerSignupRequest')
export type CustomerSignupRequest = z.infer<typeof CustomerSignupRequest>

export const CustomerLogin = z
  .object({
    email: z.email().openapi({ example: 'ada@example.com' }),
    password: z.string().min(1),
  })
  .openapi('CustomerLogin')
export type CustomerLogin = z.infer<typeof CustomerLogin>

/** Public customer view — never includes the password hash. */
export const CustomerOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    firstName: z.string(),
    lastName: z.string(),
    email: z.email(),
    phoneNumber: z.string().nullable().default(null),
    avatarDocumentId: z.string().nullable().default(null),
    accountStatus: AccountStatus,
    loginType: LoginType.default('email'),
    emailVerified: z.boolean().default(false),
    preferredLanguage: PreferredLanguage.default('en'),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('CustomerOut')
export type CustomerOut = z.infer<typeof CustomerOut>

/** Internal DB document shape for the `customers` collection. */
export interface CustomerDoc {
  firstName: string
  lastName: string
  email: string
  password: string
  phoneNumber?: string | null
  avatarDocumentId?: string | null
  accountStatus: AccountStatus
  loginType: LoginType
  emailVerified: boolean
  preferredLanguage: 'en' | 'fr'
  permissionList?: string[] | null
  authProvider?: string | null
  authSubject?: string | null
  lastAuthAt?: number | null
  dateCreated: number
  lastUpdated: number
}
