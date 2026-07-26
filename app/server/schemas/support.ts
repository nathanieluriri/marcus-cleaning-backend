import { z } from '@hono/zod-openapi'

/**
 * FAQ content and support tickets.
 *
 * FAQ entries live in the `faq_entries` collection so copy can change without
 * an app release; each entry is tagged with the audience it belongs to.
 */

export const FaqAudience = z.enum(['customer', 'staff', 'all'])
export type FaqAudience = z.infer<typeof FaqAudience>

export const FaqEntryOut = z
  .object({
    id: z.string(),
    question: z.string(),
    answer: z.string(),
    category: z.string().nullable().default(null).openapi({ example: 'Bookings' }),
    audience: FaqAudience.default('all'),
    /** Ascending display order within a category. */
    position: z.number().int().default(0),
  })
  .openapi('FaqEntryOut')
export type FaqEntryOut = z.infer<typeof FaqEntryOut>

export const FaqListOut = z
  .object({
    items: z.array(FaqEntryOut),
    categories: z.array(z.string()).default([]),
  })
  .openapi('FaqListOut')
export type FaqListOut = z.infer<typeof FaqListOut>

// --- support tickets --------------------------------------------------------

export const TicketStatus = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'])
export type TicketStatus = z.infer<typeof TicketStatus>

export const TicketCategory = z.enum([
  'BOOKING',
  'PAYMENT',
  'CLEANER',
  'ACCOUNT',
  'APP_ISSUE',
  'SAFETY',
  'OTHER',
])
export type TicketCategory = z.infer<typeof TicketCategory>

export const SupportTicketCreateRequest = z
  .object({
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5000),
    category: TicketCategory.default('OTHER'),
    /** Optional link to the booking the ticket is about. */
    bookingId: z.string().nullable().optional(),
    /** Document ids for screenshots, uploaded via /v1/documents. */
    attachmentDocumentIds: z.array(z.string()).default([]),
  })
  .openapi('SupportTicketCreateRequest')
export type SupportTicketCreateRequest = z.infer<typeof SupportTicketCreateRequest>

export const SupportTicketOut = z
  .object({
    id: z.string(),
    /** Short human reference shown to the user, e.g. for an email follow-up. */
    reference: z.string().openapi({ example: 'SUP-8F3K2A' }),
    requesterId: z.string(),
    requesterRole: z.enum(['customer', 'cleaner']),
    subject: z.string(),
    message: z.string(),
    category: TicketCategory,
    status: TicketStatus,
    bookingId: z.string().nullable().default(null),
    attachmentDocumentIds: z.array(z.string()).default([]),
    /** Latest support reply, when there is one. */
    lastResponse: z.string().nullable().default(null),
    respondedAt: z.number().int().nullable().default(null),
    resolvedAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('SupportTicketOut')
export type SupportTicketOut = z.infer<typeof SupportTicketOut>

export const SupportTicketListOut = z
  .object({
    items: z.array(SupportTicketOut),
    nextCursor: z.string().nullable().default(null),
    pageSize: z.number().int(),
  })
  .openapi('SupportTicketListOut')
export type SupportTicketListOut = z.infer<typeof SupportTicketListOut>

/** Internal DB document shape for `support_tickets`. */
export interface SupportTicketDoc {
  reference: string
  requesterId: string
  requesterRole: 'customer' | 'cleaner'
  requesterEmail?: string | null
  subject: string
  message: string
  category: TicketCategory
  status: TicketStatus
  bookingId?: string | null
  attachmentDocumentIds: string[]
  lastResponse?: string | null
  respondedAt?: number | null
  resolvedAt?: number | null
  dateCreated: number
  lastUpdated: number
}
