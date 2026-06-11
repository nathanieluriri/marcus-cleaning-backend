import { z } from '@hono/zod-openapi'

/**
 * Review domain schemas (Zod + OpenAPI).
 * Ported from `schemas/review_schema.py` (collection `reviews`).
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

export const ReviewCreateRequest = z
  .object({
    cleaner_id: z.string().min(1).openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    booking_id: z.string().min(1).nullable().optional().openapi({ example: '665f1b2c9a1e4b0012abcd99' }),
    rating: z.number().min(1).max(5).openapi({ example: 5 }),
    comment: z.string().nullable().optional().openapi({ example: 'Excellent service!' }),
  })
  .openapi('ReviewCreateRequest')
export type ReviewCreateRequest = z.infer<typeof ReviewCreateRequest>

export const ReviewUpdateRequest = z
  .object({
    rating: z.number().min(1).max(5).optional(),
    comment: z.string().nullable().optional(),
  })
  .openapi('ReviewUpdateRequest')
export type ReviewUpdateRequest = z.infer<typeof ReviewUpdateRequest>

/** Optional `cleaner_id` filter for the list endpoint. */
export const ReviewListQuery = z
  .object({
    cleaner_id: z.string().optional().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
  })
  .openapi('ReviewListQuery')
export type ReviewListQuery = z.infer<typeof ReviewListQuery>

export const ReviewOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    customer_id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd11' }),
    cleaner_id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    booking_id: z.string().nullable().default(null),
    rating: z.number(),
    comment: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('ReviewOut')
export type ReviewOut = z.infer<typeof ReviewOut>

/** Internal DB document shape for the `reviews` collection. */
export interface ReviewDoc {
  customer_id: string
  cleaner_id: string
  booking_id?: string | null
  rating: number
  comment?: string | null
  dateCreated: number
  lastUpdated: number
}
