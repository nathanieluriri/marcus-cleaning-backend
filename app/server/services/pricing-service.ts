import * as generic from '@/server/repositories/admin-features/_generic-repo'
import type { BookingAddon } from '@/server/schemas/booking'

/**
 * Pricing — backend-authoritative quote computation.
 *
 * Reads the admin `service_definitions` (base price) and `addon_catalog` (add-on
 * prices) collections. Those are permissive `.passthrough()` admin docs, so we
 * read defensively (basePrice ?? price, etc.). Money is in major units here;
 * callers convert to minor units for the payment provider.
 *
 * See: docs/migration/07-domain-endpoints.md (POST /bookings/quote),
 *      docs/migration/09-payments.md
 */

const SERVICE_DEFS = 'service_definitions'
const ADDON_CATALOG = 'addon_catalog'
const DEFAULT_CURRENCY = 'USD'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

export interface Quote {
  base: number
  addons: number
  fees: number
  total: number
  currency: string
}

export interface AddonItem {
  addonId: string
  quantity: number
}

/**
 * Compute a price quote from a service id + add-on items. Unknown service or
 * add-on ids contribute 0 (the catalog is the source of truth; missing prices
 * are treated as free rather than erroring, so a quote always resolves).
 */
export async function computeQuote(serviceId: string | null, addonItems: AddonItem[]): Promise<Quote> {
  let base = 0
  let currency = DEFAULT_CURRENCY

  if (serviceId) {
    const service = await generic.getDocById(SERVICE_DEFS, serviceId)
    if (service) {
      base = num(service.basePrice ?? service.price) ?? 0
      currency = str(service.currency, DEFAULT_CURRENCY)
    }
  }

  let addons = 0
  for (const item of addonItems) {
    const qty = item.quantity > 0 ? item.quantity : 1
    const addon = await generic.getDocById(ADDON_CATALOG, item.addonId)
    if (addon) addons += (num(addon.price) ?? 0) * qty
  }

  // Platform/service fees — currently none. Kept explicit so a future fee model
  // (flat or percentage) has an obvious home without changing the response shape.
  const fees = 0

  const round2 = (n: number) => Math.round(n * 100) / 100
  base = round2(base)
  addons = round2(addons)
  const total = round2(base + addons + fees)
  return { base, addons, fees, total, currency }
}

/** Quote for an existing booking (expands stored BookingAddon quantities). */
export async function quoteForBooking(booking: {
  serviceId?: string | null
  addons?: BookingAddon[] | null
}): Promise<Quote> {
  const items: AddonItem[] = (booking.addons ?? []).map((a) => ({ addonId: a.addonId, quantity: a.quantity }))
  return computeQuote(booking.serviceId ?? null, items)
}

/** Convert a major-unit amount to integer minor units (e.g. 45.5 -> 4550). */
export function toMinorUnits(amountMajor: number): number {
  return Math.round(amountMajor * 100)
}
