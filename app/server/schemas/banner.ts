import { z } from '@hono/zod-openapi'

/**
 * Banner domain schemas (Zod + OpenAPI).
 * Ported from `schemas/banner_schema.py` (collection `banner`).
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

export const BannerCreateRequest = z
  .object({
    title: z.string().min(1).openapi({ example: 'Summer Sale' }),
    imageUrl: z.string().min(1).openapi({ example: 'https://cdn.example.com/banner.png' }),
    linkUrl: z.string().nullable().optional().openapi({ example: 'https://example.com/promo' }),
    description: z.string().nullable().optional(),
    active: z.boolean().optional().openapi({ example: true }),
    sortOrder: z.number().int().optional().openapi({ example: 0 }),
  })
  .openapi('BannerCreateRequest')
export type BannerCreateRequest = z.infer<typeof BannerCreateRequest>

export const BannerUpdateRequest = z
  .object({
    title: z.string().min(1).optional(),
    imageUrl: z.string().min(1).optional(),
    linkUrl: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .openapi('BannerUpdateRequest')
export type BannerUpdateRequest = z.infer<typeof BannerUpdateRequest>

export const BannerOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    title: z.string(),
    imageUrl: z.string(),
    linkUrl: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('BannerOut')
export type BannerOut = z.infer<typeof BannerOut>

/** Internal DB document shape for the `banner` collection. */
export interface BannerDoc {
  title: string
  imageUrl: string
  linkUrl?: string | null
  description?: string | null
  active: boolean
  sortOrder: number
  dateCreated: number
  lastUpdated: number
}
