import { z } from '@hono/zod-openapi'

/**
 * Admin broadcasts — one notification sent to a segment of users
 * (`broadcasts` + `broadcast_deliveries`).
 *
 * A broadcast always creates an in-app notification row per recipient as well
 * as a push. A promo the user swipes away would otherwise be gone forever, and
 * the notifications tab is where people look for offers they half-remember.
 *
 * Fan-out is batched and resumable: recipients are resolved once and stored, so
 * a serverless timeout mid-send cannot double-send or lose the remainder.
 */

/** Who a broadcast goes to. */
export const AudienceType = z.enum([
  'ALL',
  'ALL_CUSTOMERS',
  'ALL_CLEANERS',
  'USER_IDS',
  /** Customers with no booking in the last `inactiveDays` days — win-back. */
  'CUSTOMERS_INACTIVE',
  /** Customers who have booked at least once. */
  'CUSTOMERS_WITH_BOOKINGS',
  /** Customers who have never booked. */
  'CUSTOMERS_NEVER_BOOKED',
  /** Cleaners filtered by onboarding status. */
  'CLEANERS_BY_ONBOARDING',
])
export type AudienceType = z.infer<typeof AudienceType>

export const BroadcastAudience = z
  .object({
    type: AudienceType,
    /** For USER_IDS. Paired with `role`, since ids are per-collection. */
    userIds: z.array(z.string()).max(10_000).optional(),
    /** Which role `userIds` belong to. */
    role: z.enum(['customer', 'cleaner']).optional(),
    /** For CUSTOMERS_INACTIVE. */
    inactiveDays: z.number().int().min(1).max(3650).optional(),
    /** For CLEANERS_BY_ONBOARDING. */
    onboardingStatus: z
      .enum(['NOT_STARTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'USER_IDS') {
      if (!v.userIds?.length) {
        ctx.addIssue({ code: 'custom', message: 'userIds is required for USER_IDS', path: ['userIds'] })
      }
      if (!v.role) {
        ctx.addIssue({ code: 'custom', message: 'role is required for USER_IDS', path: ['role'] })
      }
    }
    if (v.type === 'CUSTOMERS_INACTIVE' && v.inactiveDays == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'inactiveDays is required for CUSTOMERS_INACTIVE',
        path: ['inactiveDays'],
      })
    }
    if (v.type === 'CLEANERS_BY_ONBOARDING' && !v.onboardingStatus) {
      ctx.addIssue({
        code: 'custom',
        message: 'onboardingStatus is required for CLEANERS_BY_ONBOARDING',
        path: ['onboardingStatus'],
      })
    }
  })
  .openapi('BroadcastAudience')
export type BroadcastAudience = z.infer<typeof BroadcastAudience>

export const BroadcastStatus = z.enum(['DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'])
export type BroadcastStatus = z.infer<typeof BroadcastStatus>

export const BroadcastCreateRequest = z
  .object({
    title: z.string().min(1).max(120).openapi({ example: '20% off your next deep clean' }),
    body: z.string().min(1).max(500),
    audience: BroadcastAudience,
    /**
     * Notification type, which selects the channel, sound and deep link.
     * Defaults to `promo.broadcast`.
     */
    type: z.string().default('promo.broadcast'),
    /** Attach a promo code so the app can deep-link straight to the offer. */
    promoId: z.string().nullable().optional(),
    promoCode: z.string().nullable().optional(),
    /** Extra key/values merged into the push payload. */
    data: z.record(z.string(), z.string()).nullable().optional(),
  })
  .openapi('BroadcastCreateRequest')
export type BroadcastCreateRequest = z.infer<typeof BroadcastCreateRequest>

/** Dry-run: how many people would this reach? */
export const AudiencePreviewOut = z
  .object({
    audience: BroadcastAudience,
    total: z.number().int(),
    customers: z.number().int(),
    cleaners: z.number().int(),
    /** How many of those have at least one active push device registered. */
    reachableByPush: z.number().int(),
    /** Audience size before the marketing opt-out was applied. */
    matchedBeforeOptOut: z.number().int(),
    /** How many were dropped for having marketing notifications off. */
    suppressedByOptOut: z.number().int(),
  })
  .openapi('AudiencePreviewOut')
export type AudiencePreviewOut = z.infer<typeof AudiencePreviewOut>

export const BroadcastOut = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    type: z.string(),
    audience: BroadcastAudience,
    status: BroadcastStatus,
    promoId: z.string().nullable().default(null),
    promoCode: z.string().nullable().default(null),
    data: z.record(z.string(), z.string()).nullable().default(null),
    /** Recipients resolved at dispatch time. */
    recipientCount: z.number().int().default(0),
    /** How many have been processed so far — drives resumable batching. */
    processedCount: z.number().int().default(0),
    sentCount: z.number().int().default(0),
    failedCount: z.number().int().default(0),
    createdBy: z.string().nullable().default(null),
    dispatchedAt: z.number().int().nullable().default(null),
    completedAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('BroadcastOut')
export type BroadcastOut = z.infer<typeof BroadcastOut>

export const BroadcastListOut = z
  .object({
    items: z.array(BroadcastOut),
    nextCursor: z.string().nullable().default(null),
    pageSize: z.number().int(),
  })
  .openapi('BroadcastListOut')
export type BroadcastListOut = z.infer<typeof BroadcastListOut>

/** One recipient of a broadcast. */
export interface BroadcastRecipient {
  userId: string
  role: 'customer' | 'cleaner'
}

/** Internal DB document shape for `broadcasts`. */
export interface BroadcastDoc {
  title: string
  body: string
  type: string
  audience: BroadcastAudience
  status: BroadcastStatus
  promoId?: string | null
  promoCode?: string | null
  data?: Record<string, string> | null
  /** Frozen at dispatch so a growing user base cannot change mid-send. */
  recipients: BroadcastRecipient[]
  recipientCount: number
  processedCount: number
  sentCount: number
  failedCount: number
  createdBy?: string | null
  dispatchedAt?: number | null
  completedAt?: number | null
  dateCreated: number
  lastUpdated: number
}
