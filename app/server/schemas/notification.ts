import { z } from '@hono/zod-openapi'

/**
 * Notification domain schemas (Zod + OpenAPI).
 * Ported from `schemas/notifications_schema.py` (collection `notifications`).
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

export const NotificationCreateRequest = z
  .object({
    title: z.string().min(1).openapi({ example: 'Booking confirmed' }),
    body: z.string().min(1).openapi({ example: 'Your cleaning is scheduled for tomorrow.' }),
    type: z.string().nullable().optional().openapi({ example: 'booking' }),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .openapi('NotificationCreateRequest')
export type NotificationCreateRequest = z.infer<typeof NotificationCreateRequest>

export const NotificationUpdateRequest = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    type: z.string().nullable().optional(),
    read: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .openapi('NotificationUpdateRequest')
export type NotificationUpdateRequest = z.infer<typeof NotificationUpdateRequest>

/** Who a notification belongs to. Cleaner rows are addressed by the same id column. */
export const NotificationRecipientRole = z.enum(['customer', 'cleaner'])
export type NotificationRecipientRole = z.infer<typeof NotificationRecipientRole>

export const NotificationOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    /**
     * Recipient id. Historically customer-only (hence the name, kept for
     * contract parity); for `recipientRole: 'cleaner'` rows this holds the
     * cleaner id instead.
     */
    customer_id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd11' }),
    recipientRole: NotificationRecipientRole.default('customer'),
    title: z.string(),
    body: z.string(),
    type: z.string().nullable().default(null),
    read: z.boolean().default(false),
    data: z.record(z.string(), z.unknown()).nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('NotificationOut')
export type NotificationOut = z.infer<typeof NotificationOut>

/** Internal DB document shape for the `notifications` collection. */
export interface NotificationDoc {
  customer_id: string
  recipientRole?: NotificationRecipientRole
  title: string
  body: string
  type?: string | null
  read: boolean
  data?: Record<string, unknown> | null
  dateCreated: number
  lastUpdated: number
}
