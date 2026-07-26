import { badRequest } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import {
  PromotionOut,
  computeDiscount,
  type PromotionOut as PromotionOutType,
  type PromotionRejection,
  type PromotionValidateOut,
  type PromotionValidateRequest,
} from '@/server/schemas/promotion'

/**
 * Customer-facing promotions over the admin `promo_code` collection.
 *
 * Admin documents are permissive (`.passthrough()`), so every field is read
 * defensively and normalised here rather than trusting a shape.
 */

const PROMO_CODES = 'promo_code'
const PROMO_REDEMPTIONS = 'promo_redemptions'

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Normalise a permissive admin promo document into the public shape. */
function toPromotion(doc: Record<string, unknown>): PromotionOutType {
  const rawType = String(doc.discountType ?? doc.type ?? 'PERCENT').toUpperCase()
  return PromotionOut.parse({
    id: String(doc.id ?? ''),
    code: String(doc.code ?? '').toUpperCase(),
    title: str(doc.title) ?? str(doc.name) ?? String(doc.code ?? 'Promotion'),
    description: str(doc.description),
    discountType: rawType === 'FIXED' || rawType === 'AMOUNT' ? 'FIXED' : 'PERCENT',
    discountValue: num(doc.discountValue) ?? num(doc.value) ?? num(doc.percentage) ?? 0,
    minimumSpend: num(doc.minimumSpend) ?? num(doc.minSpend),
    maximumDiscount: num(doc.maximumDiscount) ?? num(doc.maxDiscount),
    currency: str(doc.currency),
    imageUrl: str(doc.imageUrl) ?? str(doc.image),
    startsAt: num(doc.startsAt) ?? num(doc.startDate),
    expiresAt: num(doc.expiresAt) ?? num(doc.endDate),
  })
}

function isActive(doc: Record<string, unknown>): boolean {
  // Absent `active`/`isActive` means active — admin docs predate the flag.
  const flag = doc.active ?? doc.isActive ?? doc.enabled
  return flag === undefined || flag === null ? true : Boolean(flag)
}

function reject(reason: PromotionRejection, message: string, details?: Record<string, unknown>): never {
  throw badRequest(message, { code: 'PROMO_INVALID', reason, ...details })
}

/** Promotions to show on the home screen: active and currently in window. */
export async function listPromotions(): Promise<PromotionOutType[]> {
  const { items } = await generic.listDocs(PROMO_CODES, { limit: 100 })
  const now = nowEpoch()
  return items
    .filter((doc) => {
      if (!isActive(doc)) return false
      const promo = toPromotion(doc)
      if (promo.startsAt != null && promo.startsAt > now) return false
      if (promo.expiresAt != null && promo.expiresAt < now) return false
      return true
    })
    .map(toPromotion)
}

/**
 * Validate a code against a cart and return the authoritative discount.
 *
 * Rejections are 400s carrying a typed `details.reason`, so the checkout screen
 * can distinguish "expired" from "spend more" without parsing prose.
 */
export async function validatePromotion(args: {
  principal: AuthPrincipal
  payload: PromotionValidateRequest
}): Promise<PromotionValidateOut> {
  const code = args.payload.code.trim().toUpperCase()
  const now = nowEpoch()

  const { items } = await generic.listDocs(PROMO_CODES, {
    limit: 1,
    filter: { code: { $regex: `^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
  })
  const raw = items[0]
  if (!raw) reject('NOT_FOUND', 'That promo code was not recognised')
  if (!isActive(raw)) reject('INACTIVE', 'That promo code is no longer available')

  const promo = toPromotion(raw)
  if (promo.startsAt != null && promo.startsAt > now) {
    reject('NOT_STARTED', 'That promo code is not active yet', { startsAt: promo.startsAt })
  }
  if (promo.expiresAt != null && promo.expiresAt < now) {
    reject('EXPIRED', 'That promo code has expired', { expiresAt: promo.expiresAt })
  }
  if (promo.minimumSpend != null && args.payload.subtotal < promo.minimumSpend) {
    reject('MINIMUM_SPEND_NOT_MET', `Spend at least ${promo.minimumSpend} to use this code`, {
      minimumSpend: promo.minimumSpend,
      subtotal: args.payload.subtotal,
    })
  }

  // Service scoping, when the admin document names eligible services.
  const applicableServices = Array.isArray(raw.serviceIds) ? (raw.serviceIds as unknown[]).map(String) : null
  if (applicableServices?.length && args.payload.serviceId) {
    if (!applicableServices.includes(args.payload.serviceId)) {
      reject('NOT_APPLICABLE_TO_SERVICE', 'That code does not apply to this service', {
        serviceId: args.payload.serviceId,
      })
    }
  }

  // Per-customer single use, when the admin document sets `oncePerCustomer`.
  if (raw.oncePerCustomer) {
    const used = await generic.listDocs(PROMO_REDEMPTIONS, {
      limit: 1,
      filter: { promoId: promo.id, customerId: args.principal.userId },
    })
    if (used.items.length > 0) reject('ALREADY_USED', 'You have already used this code')
  }

  // Global usage cap.
  const usageLimit = num(raw.usageLimit) ?? num(raw.maxRedemptions)
  if (usageLimit != null) {
    const used = await generic.listDocs(PROMO_REDEMPTIONS, { limit: 1, filter: { promoId: promo.id } })
    if (used.total >= usageLimit) reject('USAGE_LIMIT_REACHED', 'That code has been fully redeemed')
  }

  const discount = computeDiscount(promo, args.payload.subtotal)
  return {
    valid: true,
    promotion: promo,
    subtotal: Math.round(args.payload.subtotal * 100) / 100,
    discount,
    total: Math.round((args.payload.subtotal - discount) * 100) / 100,
    currency: args.payload.currency ?? promo.currency,
  }
}

/**
 * Record that a customer redeemed a code. Called when a booking using the code
 * is paid, so that usage caps and once-per-customer rules mean something.
 */
export async function recordRedemption(args: {
  promoId: string
  customerId: string
  bookingId: string
  discount: number
}): Promise<void> {
  await generic.insertRaw(PROMO_REDEMPTIONS, { ...args, dateCreated: nowEpoch() })
}
