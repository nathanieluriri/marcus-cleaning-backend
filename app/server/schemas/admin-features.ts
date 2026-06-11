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
