import { z } from '@hono/zod-openapi'

/**
 * Admin-feature schemas.
 *
 * These are intentionally PERMISSIVE: a small base shape plus `.passthrough()`
 * so the exact Pydantic field set of each feature (service definitions, add-ons,
 * pricing rules, promo codes, etc.) can be reproduced 1:1 later without blocking
 * the migration. The authoritative field-level shapes come from porting the
 * original `schemas/*.py` models — see docs/migration/02-data-model.md.
 *
 * TODO: replace the passthrough shapes with the exact ported Pydantic models.
 */

/** Generic create body — any JSON object; per-collection validation lands later. */
export const FeatureCreate = z.object({}).passthrough().openapi('AdminFeatureCreate')
export type FeatureCreate = z.infer<typeof FeatureCreate>

/** Generic update body — partial object. */
export const FeatureUpdate = z.object({}).passthrough().openapi('AdminFeatureUpdate')
export type FeatureUpdate = z.infer<typeof FeatureUpdate>

/** Generic output — exposes `id` plus whatever fields the document carries. */
export const FeatureOut = z
  .object({
    id: z.string(),
    dateCreated: z.number().int().nullable().optional(),
    lastUpdated: z.number().int().nullable().optional(),
  })
  .passthrough()
  .openapi('AdminFeatureOut')
export type FeatureOut = z.infer<typeof FeatureOut>

export const FeatureListOut = z
  .object({
    items: z.array(FeatureOut),
    total: z.number().int(),
  })
  .openapi('AdminFeatureListOut')
export type FeatureListOut = z.infer<typeof FeatureListOut>

/** Shared list query (pagination). */
export const FeatureListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
})
export type FeatureListQuery = z.infer<typeof FeatureListQuery>

export const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '507f1f77bcf86cd799439011' }),
})

// --- feature-specific extra-endpoint shapes (permissive, await exact models) ---

export const ServiceCreditGrant = z
  .object({
    customer_id: z.string(),
    amount: z.number(),
    reason: z.string().optional(),
  })
  .passthrough()
  .openapi('ServiceCreditGrant')
export type ServiceCreditGrant = z.infer<typeof ServiceCreditGrant>

export const ServiceCreditBalanceOut = z
  .object({ customer_id: z.string(), balance: z.number() })
  .openapi('ServiceCreditBalanceOut')

export const BroadcastDispatch = z.object({}).passthrough().openapi('BroadcastDispatch')
export type BroadcastDispatch = z.infer<typeof BroadcastDispatch>

export const ConciergeCreateBooking = z.object({}).passthrough().openapi('ConciergeCreateBooking')
export type ConciergeCreateBooking = z.infer<typeof ConciergeCreateBooking>

export const ClaimDecision = z
  .object({
    decision: z.string(),
    notes: z.string().optional(),
  })
  .passthrough()
  .openapi('ClaimDecision')
export type ClaimDecision = z.infer<typeof ClaimDecision>

export const CustomerIdParam = z.object({
  customer_id: z.string().openapi({ param: { name: 'customer_id', in: 'path' } }),
})

/** How a service is priced. Mirrors `PriceUnit` in `server/schemas/catalog.ts`. */
export const AdminPriceUnit = z.enum(['HOURLY', 'FLAT'])

/**
 * Canonical create body for `service_definitions`.
 *
 * Field names are the ones the consumers actually read — see `catalog-service.ts`
 * (`title ?? name`, `basePrice ?? price`, `isAvailable ?? active`) and
 * `pricing-service.ts`. The admin console previously wrote `display_name` /
 * `is_active` / `base_duration_minutes`, which no consumer reads, so services
 * rendered as "Service" with no price and could not be deactivated.
 *
 * Plain object (not `.passthrough()`, not `.strict()`): unknown keys are stripped,
 * which drops legacy snake_case without 422-ing a client mid-deploy.
 */
export const ServiceDefinitionCreate = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    /** Major units. `pricing-service.ts` is the authority on this. */
    basePrice: z.number().nonnegative().optional(),
    hourlyRate: z.number().nonnegative().optional(),
    minimumHours: z.number().positive().optional(),
    maximumHours: z.number().positive().optional(),
    hourIncrement: z.number().positive().optional(),
    priceUnit: AdminPriceUnit.optional(),
    currency: z.string().min(1).optional(),
    isAvailable: z.boolean().optional(),
    checklist: z.array(z.string()).optional(),
    /** Internal key, no consumer reads it; retained so admins keep their handle. */
    service_key: z.string().optional(),
  })
  .openapi('ServiceDefinitionCreate')
export type ServiceDefinitionCreate = z.infer<typeof ServiceDefinitionCreate>

export const ServiceDefinitionUpdate = ServiceDefinitionCreate.partial().openapi(
  'ServiceDefinitionUpdate',
)
export type ServiceDefinitionUpdate = z.infer<typeof ServiceDefinitionUpdate>

/**
 * Canonical create body for `addon_catalog`.
 *
 * `price` is REQUIRED and in major units. `catalog-service.ts:139` reads
 * `num(d.price) ?? 0`, so the admin console's old `price_minor` meant every
 * admin-created add-on was free.
 *
 * `serviceId` is optional: `listServiceExtras` treats an unlinked add-on as
 * global (applies to every service).
 */
export const AddOnCreate = z
  .object({
    title: z.string().min(1),
    price: z.number().nonnegative(),
    currency: z.string().min(1).optional(),
    isAvailable: z.boolean().optional(),
    serviceId: z.string().min(1).optional(),
    description: z.string().optional(),
    checklist: z.array(z.string()).optional(),
    /** Internal key, no consumer reads it. */
    addon_key: z.string().optional(),
  })
  .openapi('AddOnCreate')
export type AddOnCreate = z.infer<typeof AddOnCreate>

export const AddOnUpdate = AddOnCreate.partial().openapi('AddOnUpdate')
export type AddOnUpdate = z.infer<typeof AddOnUpdate>

export const AdminDiscountType = z.enum(['PERCENT', 'FIXED'])

/**
 * Canonical create body for `promo_code`.
 *
 * `promotion-service.ts` reads `discountValue ?? value ?? percentage` and falls
 * back to 0, so the admin console's `discount_value` produced promos that applied
 * no discount. `active` (not `is_active`) is the flag `isActive()` reads; a missing
 * flag is treated as ACTIVE by design there, which made deactivation inert.
 */
const PromoCodeFields = z.object({
  code: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  title: z.string().optional(),
  description: z.string().optional(),
  discountType: AdminDiscountType,
  discountValue: z.number().positive(),
  minimumSpend: z.number().nonnegative().optional(),
  maximumDiscount: z.number().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  imageUrl: z.string().optional(),
  /** Epoch seconds. */
  startsAt: z.number().int().optional(),
  expiresAt: z.number().int().optional(),
  active: z.boolean().optional(),
  applicableServices: z.array(z.string()).optional(),
  maxRedemptions: z.number().int().positive().optional(),
})

export const PromoCodeCreate = PromoCodeFields
  .refine((v) => v.discountType !== 'PERCENT' || v.discountValue <= 100, {
    message: 'A percent discount cannot exceed 100',
    path: ['discountValue'],
  })
  .refine((v) => v.startsAt == null || v.expiresAt == null || v.expiresAt > v.startsAt, {
    message: 'expiresAt must be after startsAt',
    path: ['expiresAt'],
  })
  .openapi('PromoCodeCreate')
export type PromoCodeCreate = z.infer<typeof PromoCodeCreate>

export const PromoCodeUpdate = PromoCodeFields.partial()
  .refine(
    (v) => {
      if (v.discountValue == null) return true
      // Conservative for a money path: if the patch doesn't specify discountType,
      // we cannot confirm it's a FIXED promo, so a value >100 is rejected unless
      // discountType === 'FIXED' is explicitly present in this patch.
      if (v.discountType === 'FIXED') return true
      return v.discountValue <= 100
    },
    {
      message: 'A percent discount cannot exceed 100',
      path: ['discountValue'],
    },
  )
  .refine((v) => v.startsAt == null || v.expiresAt == null || v.expiresAt > v.startsAt, {
    message: 'expiresAt must be after startsAt',
    path: ['expiresAt'],
  })
  .openapi('PromoCodeUpdate')
export type PromoCodeUpdate = z.infer<typeof PromoCodeUpdate>

/**
 * `service_area_boundary` and `dynamic_pricing_rule` have NO backend consumers —
 * nothing reads them today. Field names are therefore left exactly as the admin
 * console already writes them: with no reader there is no canonical vocabulary to
 * match, and renaming would be pure churn. These schemas add validation only.
 */
export const ServiceAreaCreate = z
  .object({
    zone_code: z.string().min(1),
    display_name: z.string().min(1),
    zip_codes: z.array(z.string()).optional(),
    /** Only checks that the string parses as JSON, not that it is valid GeoJSON (e.g. `"123"` passes). */
    boundary_geojson: z
      .string()
      .optional()
      .refine((v) => {
        if (v == null || v === '') return true
        try {
          JSON.parse(v)
          return true
        } catch {
          return false
        }
      }, { message: 'boundary_geojson must be valid JSON' }),
    is_active: z.boolean().optional(),
  })
  .openapi('ServiceAreaCreate')
export type ServiceAreaCreate = z.infer<typeof ServiceAreaCreate>

export const ServiceAreaUpdate = ServiceAreaCreate.partial().openapi('ServiceAreaUpdate')
export type ServiceAreaUpdate = z.infer<typeof ServiceAreaUpdate>

/**
 * Common `rule_type` values, for the admin UI's guided picker (Task 12) only.
 * Not a Zod enum and not used for validation: `dynamic_pricing_rule` has no
 * backend consumer, so there is no contract anchoring this list, and enforcing
 * it here would risk rejecting a PATCH of a legitimate record stored with a
 * `rule_type` outside this set. The UI guides; the API does not reject.
 */
export const COMMON_PRICING_RULE_TYPES = ['time_window', 'day_of_week', 'zone', 'demand'] as const

export const PricingRuleCreate = z
  .object({
    rule_name: z.string().min(1),
    rule_type: z.string().min(1),
    multiplier: z.number().positive(),
    priority: z.number().int(),
    zone_codes: z.array(z.string()).optional(),
    day_of_week: z.array(z.string()).optional(),
    start_hour: z.number().int().min(0).max(23).optional(),
    end_hour: z.number().int().min(0).max(23).optional(),
    is_active: z.boolean().optional(),
  })
  .openapi('PricingRuleCreate')
export type PricingRuleCreate = z.infer<typeof PricingRuleCreate>

export const PricingRuleUpdate = PricingRuleCreate.partial().openapi('PricingRuleUpdate')
export type PricingRuleUpdate = z.infer<typeof PricingRuleUpdate>
