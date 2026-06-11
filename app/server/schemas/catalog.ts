import { z } from '@hono/zod-openapi'

/**
 * Public, read-only projections of the admin `service_definitions` and
 * `addon_catalog` collections (which are `.passthrough()` admin docs). These
 * shapes are intentionally narrow + defensive so customers never see admin
 * internals. See docs/superpowers/specs/2026-06-11-mobile-backend-endpoints-design.md §5.1.3.
 */

export const ServiceExtraOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012addon' }),
    title: z.string().openapi({ example: 'Inside oven' }),
    price: z.number().openapi({ example: 20 }),
    isAvailable: z.boolean().default(true),
  })
  .openapi('ServiceExtraOut')
export type ServiceExtraOut = z.infer<typeof ServiceExtraOut>

export const CatalogServiceOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012service' }),
    title: z.string().openapi({ example: 'Deep clean' }),
    description: z.string().nullable().default(null).openapi({ example: 'A thorough top-to-bottom clean.' }),
    basePrice: z.number().nullable().default(null).openapi({ example: 45 }),
    isAvailable: z.boolean().default(true),
  })
  .openapi('CatalogServiceOut')
export type CatalogServiceOut = z.infer<typeof CatalogServiceOut>
