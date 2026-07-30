import * as generic from '@/server/repositories/admin-features/_generic-repo'
import type { BookingAddon } from '@/server/schemas/booking'
import { AppError } from '@/server/core/errors'

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
 * Validate `hours` against a service's hourly pricing config and return the
 * computed base price. Float-safe increment check: rounds the number of
 * increment-steps rather than comparing the raw modulo, so 2.7 - 2 = 0.7 over
 * a 0.5 increment (1.4 steps) correctly fails while binary-float noise (e.g.
 * 0.1 + 0.2 !== 0.3) does not cause false negatives.
 */
function priceHourly(
  service: Record<string, unknown>,
  hours: number,
): number {
  const hourlyRate = num(service.hourlyRate ?? service.ratePerHour ?? service.pricePerHour)
  const minimumHours = num(service.minimumHours ?? service.minHours) ?? 1
  const maximumHours = num(service.maximumHours ?? service.maxHours)
  const hourIncrement = num(service.hourIncrement ?? service.durationStepHours) ?? 0.5

  if (hourlyRate == null) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Service is not hourly-priced', {
      minimumHours,
      maximumHours,
      hourIncrement,
    })
  }

  const steps = (hours - minimumHours) / hourIncrement
  const roundedHours = Math.round(steps) * hourIncrement + minimumHours
  const onIncrement = Math.abs(roundedHours - hours) < 1e-6

  if (hours < minimumHours || (maximumHours != null && hours > maximumHours) || !onIncrement) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Invalid booking duration', {
      minimumHours,
      maximumHours,
      hourIncrement,
    })
  }

  return hourlyRate * hours
}

/**
 * Compute a price quote from a service id + add-on items. Unknown service or
 * add-on ids contribute 0 (the catalog is the source of truth; missing prices
 * are treated as free rather than erroring, so a quote always resolves).
 *
 * `hours` — when provided, the service MUST be hourly-priced and `hours` must
 * satisfy its minimum/maximum/increment constraints (422 otherwise). When
 * omitted, pricing falls back to the flat `basePrice ?? price` (today's
 * behavior), unchanged.
 */
export async function computeQuote(
  serviceId: string | null,
  addonItems: AddonItem[],
  hours?: number | null,
): Promise<Quote> {
  let base = 0
  let currency = DEFAULT_CURRENCY

  if (serviceId) {
    const service = await generic.getDocById(SERVICE_DEFS, serviceId)
    if (service) {
      currency = str(service.currency, DEFAULT_CURRENCY)
      if (hours != null) {
        base = priceHourly(service, hours)
      } else {
        base = num(service.basePrice ?? service.price) ?? 0
      }
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
  hours?: number | null
}): Promise<Quote> {
  const items: AddonItem[] = (booking.addons ?? []).map((a) => ({ addonId: a.addonId, quantity: a.quantity }))
  return computeQuote(booking.serviceId ?? null, items, booking.hours ?? null)
}

/** Convert a major-unit amount to integer minor units (e.g. 45.5 -> 4550). */
export function toMinorUnits(amountMajor: number): number {
  return Math.round(amountMajor * 100)
}
