import { z } from '@hono/zod-openapi'

/**
 * Cleaner onboarding application (`cleaner_applications` collection).
 *
 * Mirrors the staff app's four-step wizard: personal details, documents,
 * services + service radius, weekly availability, and payout details. The
 * client PATCHes a draft as the cleaner progresses, then submits it.
 *
 * State machine (also enforced in cleaner-application-service):
 *
 *   DRAFT ──submit──> SUBMITTED ──admin──> UNDER_REVIEW ─┬─> APPROVED   (terminal)
 *                                                        ├─> REJECTED   (terminal)
 *                                                        └─> MORE_INFO_REQUIRED
 *   MORE_INFO_REQUIRED ──cleaner edits + resubmits──> SUBMITTED
 *
 * The cleaner may edit only in DRAFT and MORE_INFO_REQUIRED. APPROVED and
 * REJECTED are terminal: a rejected applicant must be reopened by an admin
 * (to MORE_INFO_REQUIRED) before they can change anything.
 */

export const ApplicationStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'REJECTED',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

/** Statuses in which the cleaner may still edit their application. */
export const EDITABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'MORE_INFO_REQUIRED']

export const DayOfWeek = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
export type DayOfWeek = z.infer<typeof DayOfWeek>

/** A bookable window on one weekday. Times are local "HH:mm" in the cleaner's area. */
export const AvailabilityWindow = z
  .object({
    day: DayOfWeek,
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).openapi({ example: '09:00' }),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).openapi({ example: '17:00' }),
  })
  .refine((w) => w.start < w.end, { message: 'start must be before end' })
  .openapi('AvailabilityWindow')
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>

export const PersonalDetails = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().min(1).nullable().optional(),
    dateOfBirth: z.string().nullable().optional().openapi({ example: '1994-04-02', description: 'ISO date (YYYY-MM-DD).' }),
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    country: z.string().nullable().optional().openapi({ example: 'US' }),
    bio: z.string().max(2000).nullable().optional(),
  })
  .openapi('ApplicationPersonalDetails')
export type PersonalDetails = z.infer<typeof PersonalDetails>

/**
 * Payout details. Bank credentials are NEVER stored here — the client tokenizes
 * them with the payment provider and sends only the resulting token plus the
 * display-safe remnants shown back to the cleaner.
 */
export const PayoutDetails = z
  .object({
    provider: z.enum(['stripe', 'flutterwave', 'test']).openapi({ example: 'stripe' }),
    /** Opaque provider token / connected-account id. */
    accountToken: z.string().min(1).openapi({ example: 'acct_1P...' }),
    accountHolderName: z.string().nullable().optional(),
    bankName: z.string().nullable().optional(),
    /** Display remnant only — never a full account number or IBAN. */
    last4: z.string().length(4).nullable().optional().openapi({ example: '4242' }),
    currency: z.string().nullable().optional().openapi({ example: 'USD' }),
  })
  .openapi('ApplicationPayoutDetails')
export type PayoutDetails = z.infer<typeof PayoutDetails>

/** A document attached to the application (created via /v1/documents). */
export const ApplicationDocument = z
  .object({
    documentId: z.string(),
    kind: z.enum(['GOVERNMENT_ID', 'PROOF_OF_ADDRESS', 'CERTIFICATION', 'OTHER']),
    fileName: z.string().nullable().default(null),
    contentType: z.string().nullable().default(null),
    /** Presigned GET URL, populated on read. Never persisted. */
    url: z.string().nullable().default(null),
    uploadedAt: z.number().int().nullable().default(null),
  })
  .openapi('ApplicationDocument')
export type ApplicationDocument = z.infer<typeof ApplicationDocument>

/** Draft upsert body. Every field optional — the wizard patches step by step. */
export const ApplicationUpsertRequest = z
  .object({
    personalDetails: PersonalDetails.optional(),
    serviceIds: z.array(z.string()).optional(),
    serviceRadiusMiles: z.number().min(0).max(200).nullable().optional(),
    availability: z.array(AvailabilityWindow).optional(),
    payoutDetails: PayoutDetails.nullable().optional(),
  })
  .openapi('ApplicationUpsertRequest')
export type ApplicationUpsertRequest = z.infer<typeof ApplicationUpsertRequest>

export const ApplicationDocumentAttachRequest = z
  .object({
    documentId: z.string().min(1),
    kind: z.enum(['GOVERNMENT_ID', 'PROOF_OF_ADDRESS', 'CERTIFICATION', 'OTHER']).default('GOVERNMENT_ID'),
  })
  .openapi('ApplicationDocumentAttachRequest')
export type ApplicationDocumentAttachRequest = z.infer<typeof ApplicationDocumentAttachRequest>

/** Admin decision on a submitted application. */
export const ApplicationDecisionRequest = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_MORE_INFO', 'START_REVIEW']),
    /** Shown to the cleaner on the verification-status screen. */
    note: z.string().max(2000).nullable().optional(),
    /** Which parts need fixing, for REQUEST_MORE_INFO. */
    missingFields: z.array(z.string()).optional(),
  })
  .openapi('ApplicationDecisionRequest')
export type ApplicationDecisionRequest = z.infer<typeof ApplicationDecisionRequest>

export const ApplicationOut = z
  .object({
    id: z.string(),
    cleanerId: z.string(),
    status: ApplicationStatus,
    personalDetails: PersonalDetails.default({}),
    documents: z.array(ApplicationDocument).default([]),
    serviceIds: z.array(z.string()).default([]),
    serviceRadiusMiles: z.number().nullable().default(null),
    availability: z.array(AvailabilityWindow).default([]),
    /** Payout details are returned redacted — the token is never echoed back. */
    payoutDetails: z
      .object({
        provider: z.string(),
        accountHolderName: z.string().nullable().default(null),
        bankName: z.string().nullable().default(null),
        last4: z.string().nullable().default(null),
        currency: z.string().nullable().default(null),
      })
      .nullable()
      .default(null),
    /** What the cleaner still has to provide before they can submit. */
    missingRequirements: z.array(z.string()).default([]),
    canSubmit: z.boolean().default(false),
    canEdit: z.boolean().default(true),
    reviewNote: z.string().nullable().default(null),
    submittedAt: z.number().int().nullable().default(null),
    reviewedAt: z.number().int().nullable().default(null),
    reviewedBy: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('ApplicationOut')
export type ApplicationOut = z.infer<typeof ApplicationOut>

/** Internal DB document shape for `cleaner_applications`. */
export interface ApplicationDoc {
  cleanerId: string
  status: ApplicationStatus
  personalDetails: PersonalDetails
  documents: Array<Omit<ApplicationDocument, 'url'>>
  serviceIds: string[]
  serviceRadiusMiles?: number | null
  availability: AvailabilityWindow[]
  payoutDetails?: PayoutDetails | null
  reviewNote?: string | null
  missingFields?: string[] | null
  submittedAt?: number | null
  reviewedAt?: number | null
  reviewedBy?: string | null
  dateCreated: number
  lastUpdated: number
}

// --- pure helpers (unit-tested) --------------------------------------------

/** Everything an application needs before it can be submitted for review. */
export function missingRequirementsFor(app: {
  personalDetails: PersonalDetails
  documents: Array<{ kind: string }>
  serviceIds: string[]
  availability: AvailabilityWindow[]
  payoutDetails?: PayoutDetails | null
}): string[] {
  const missing: string[] = []
  if (!app.personalDetails?.firstName) missing.push('personalDetails.firstName')
  if (!app.personalDetails?.lastName) missing.push('personalDetails.lastName')
  if (!app.personalDetails?.phone) missing.push('personalDetails.phone')
  if (!app.documents.some((d) => d.kind === 'GOVERNMENT_ID')) missing.push('documents.GOVERNMENT_ID')
  if (app.serviceIds.length === 0) missing.push('serviceIds')
  if (app.availability.length === 0) missing.push('availability')
  if (!app.payoutDetails) missing.push('payoutDetails')
  return missing
}

/** Allowed application transitions, mirroring the diagram above. */
const ALLOWED: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED'],
  MORE_INFO_REQUIRED: ['SUBMITTED'],
  APPROVED: [],
  REJECTED: ['MORE_INFO_REQUIRED'],
}

export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

export function allowedApplicationTransitions(from: ApplicationStatus): readonly ApplicationStatus[] {
  return ALLOWED[from] ?? []
}
