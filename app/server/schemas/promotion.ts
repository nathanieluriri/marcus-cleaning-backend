import { z } from '@hono/zod-openapi'

/**
 * Customer-facing promotions (read-only projection of the admin `promo_code`
 * collection, plus the code-validation endpoint used at checkout).
 *
 * Discount arithmetic is server-side only: the client sends the code and the
 * cart, and receives the amounts to display. It never computes a discount.
 */

export const DiscountType = z.enum(['PERCENT', 'FIXED'])
export type DiscountType = z.infer<typeof DiscountType>

export const PromotionOut = z
  .object({
    id: z.string(),
    code: z.string().openapi({ example: 'SPARKLE20' }),
    title: z.string(),
    description: z.string().nullable().default(null),
    discountType: DiscountType,
    /** Percent (0-100) for PERCENT, major units for FIXED. */
    discountValue: z.number(),
    minimumSpend: z.number().nullable().default(null),
    maximumDiscount: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    startsAt: z.number().int().nullable().default(null),
    expiresAt: z.number().int().nullable().default(null),
  })
  .openapi('PromotionOut')
export type PromotionOut = z.infer<typeof PromotionOut>

export const PromotionValidateRequest = z
  .object({
    code: z.string().min(1).openapi({ example: 'SPARKLE20' }),
    /** Cart subtotal in major units — the discount is computed against this. */
    subtotal: z.number().nonnegative().openapi({ example: 65 }),
    serviceId: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
  })
  .openapi('PromotionValidateRequest')
export type PromotionValidateRequest = z.infer<typeof PromotionValidateRequest>

export const PromotionValidateOut = z
  .object({
    valid: z.literal(true),
    promotion: PromotionOut,
    subtotal: z.number(),
    discount: z.number().openapi({ example: 13 }),
    total: z.number().openapi({ example: 52 }),
    currency: z.string().nullable().default(null),
  })
  .openapi('PromotionValidateOut')
export type PromotionValidateOut = z.infer<typeof PromotionValidateOut>

/**
 * Why a code was rejected. Returned as the `details.reason` of a 400 so the
 * checkout screen can show a specific message rather than a generic failure.
 */
export const PromotionRejection = z.enum([
  'NOT_FOUND',
  'EXPIRED',
  'NOT_STARTED',
  'INACTIVE',
  'MINIMUM_SPEND_NOT_MET',
  'USAGE_LIMIT_REACHED',
  'ALREADY_USED',
  'NOT_APPLICABLE_TO_SERVICE',
])
export type PromotionRejection = z.infer<typeof PromotionRejection>

/** Compute the discount for a promotion against a subtotal. Pure. */
export function computeDiscount(
  promo: Pick<PromotionOut, 'discountType' | 'discountValue' | 'maximumDiscount'>,
  subtotal: number,
): number {
  const raw =
    promo.discountType === 'PERCENT' ? (subtotal * promo.discountValue) / 100 : promo.discountValue
  const capped = promo.maximumDiscount != null ? Math.min(raw, promo.maximumDiscount) : raw
  // A discount can never exceed the subtotal or go negative.
  return Math.round(Math.min(Math.max(capped, 0), subtotal) * 100) / 100
}
