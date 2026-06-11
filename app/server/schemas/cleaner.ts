import { z } from '@hono/zod-openapi'
import { AccountStatus, LoginType, PreferredLanguage } from './customer'

/**
 * Cleaner domain schemas. Ported from `schemas/cleaner_schema.py`.
 * See: docs/migration/07-domain-endpoints.md
 */

export const CleanerOnboardingStatus = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
])
export type CleanerOnboardingStatus = z.infer<typeof CleanerOnboardingStatus>

export const CleanerSignupRequest = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
    phoneNumber: z.string().optional(),
  })
  .openapi('CleanerSignupRequest')
export type CleanerSignupRequest = z.infer<typeof CleanerSignupRequest>

export const CleanerLogin = z
  .object({ email: z.email(), password: z.string().min(1) })
  .openapi('CleanerLogin')
export type CleanerLogin = z.infer<typeof CleanerLogin>

export const CleanerOnboardingUpdate = z
  .object({
    bio: z.string().optional(),
    skills: z.array(z.string()).optional(),
    equipment: z.array(z.string()).optional(),
    serviceAreaIds: z.array(z.string()).optional(),
    allowAdminSelection: z.boolean().optional(),
  })
  .openapi('CleanerOnboardingUpdate')
export type CleanerOnboardingUpdate = z.infer<typeof CleanerOnboardingUpdate>

export const CleanerOut = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.email(),
    phoneNumber: z.string().nullable().default(null),
    accountStatus: AccountStatus,
    loginType: LoginType.default('email'),
    onboardingStatus: CleanerOnboardingStatus.default('NOT_STARTED'),
    allowAdminSelection: z.boolean().default(false),
    emailVerified: z.boolean().default(false),
    preferredLanguage: PreferredLanguage.default('en'),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('CleanerOut')
export type CleanerOut = z.infer<typeof CleanerOut>

export interface CleanerDoc {
  firstName: string
  lastName: string
  email: string
  password: string
  phoneNumber?: string | null
  accountStatus: AccountStatus
  loginType: LoginType
  onboardingStatus: CleanerOnboardingStatus
  allowAdminSelection: boolean
  emailVerified: boolean
  preferredLanguage: 'en' | 'fr'
  permissionList?: string[] | null
  bio?: string | null
  skills?: string[] | null
  equipment?: string[] | null
  serviceAreaIds?: string[] | null
  serviceRadiusMiles?: number | null
  availableDays?: string[] | null
  authProvider?: string | null
  authSubject?: string | null
  lastAuthAt?: number | null
  dateCreated: number
  lastUpdated: number
}
