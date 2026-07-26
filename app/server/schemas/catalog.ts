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

/** How a service is priced — drives the "from $X" copy on the catalogue card. */
export const PriceUnit = z.enum(['HOURLY', 'FLAT'])
export type PriceUnit = z.infer<typeof PriceUnit>

export const CatalogServiceOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012service' }),
    title: z.string().openapi({ example: 'Deep clean' }),
    description: z.string().nullable().default(null).openapi({ example: 'A thorough top-to-bottom clean.' }),
    basePrice: z.number().nullable().default(null).openapi({ example: 45 }),
    /** Per-hour rate when `priceUnit` is HOURLY. Null for flat-priced services. */
    hourlyRate: z.number().nullable().default(null).openapi({ example: 25 }),
    /** Shortest bookable duration, in hours. Null when not configured. */
    minimumHours: z.number().nullable().default(null).openapi({ example: 2 }),
    priceUnit: PriceUnit.default('FLAT'),
    /**
     * The number to render as "from $X" — the hourly rate for HOURLY services,
     * the base price for FLAT ones. Computed here so the copy has one source.
     */
    startingPrice: z.number().nullable().default(null).openapi({ example: 25 }),
    currency: z.string().nullable().default(null).openapi({ example: 'USD' }),
    isAvailable: z.boolean().default(true),
  })
  .openapi('CatalogServiceOut')
export type CatalogServiceOut = z.infer<typeof CatalogServiceOut>

/**
 * Everything the Duration & Extras screen needs in one call: the rate, the
 * minimum, the increment, and the add-ons with their prices.
 */
export const ServicePricingOut = z
  .object({
    serviceId: z.string(),
    title: z.string(),
    priceUnit: PriceUnit,
    basePrice: z.number().nullable().default(null),
    hourlyRate: z.number().nullable().default(null),
    minimumHours: z.number().nullable().default(null),
    /** Step between selectable durations, in hours. */
    hourIncrement: z.number().default(0.5),
    maximumHours: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    extras: z.array(ServiceExtraOut).default([]),
    /**
     * Reminder that the client must not total these itself — POST
     * /v1/bookings/quote is the authoritative price.
     */
    quotePath: z.string().default('/api/v1/bookings/quote'),
  })
  .openapi('ServicePricingOut')
export type ServicePricingOut = z.infer<typeof ServicePricingOut>
