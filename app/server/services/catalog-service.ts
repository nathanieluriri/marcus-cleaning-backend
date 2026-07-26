import { notFound } from '@/server/core/errors'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import {
  CatalogServiceOut,
  ServiceExtraOut,
  ServicePricingOut,
  type PriceUnit,
} from '@/server/schemas/catalog'

/**
 * Public, read-only projection of the admin `service_definitions` and
 * `addon_catalog` collections. Admin docs are `.passthrough()` with an
 * unverified field set, so we read defensively and only surface a narrow,
 * customer-safe shape. See spec §5.1.3.
 */

const SERVICE_DEFS = 'service_definitions'
const ADDON_CATALOG = 'addon_catalog'

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}
function bool(v: unknown, fallback = true): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Read the rate/minimum fields off a permissive admin service document.
 *
 * A service counts as HOURLY when the admin set an hourly rate; otherwise it is
 * flat-priced. `startingPrice` is resolved here so the "from $X" copy on the
 * catalogue card has exactly one source of truth.
 */
function pricingOf(d: Record<string, unknown>): {
  priceUnit: PriceUnit
  basePrice: number | null
  hourlyRate: number | null
  minimumHours: number | null
  maximumHours: number | null
  hourIncrement: number
  startingPrice: number | null
  currency: string | null
} {
  const basePrice = num(d.basePrice ?? d.price)
  const hourlyRate = num(d.hourlyRate ?? d.ratePerHour ?? d.pricePerHour)
  const declared = str(d.priceUnit ?? d.pricingModel ?? '').toUpperCase()

  const priceUnit: PriceUnit =
    declared === 'HOURLY' || declared === 'FLAT'
      ? (declared as PriceUnit)
      : hourlyRate != null
        ? 'HOURLY'
        : 'FLAT'

  return {
    priceUnit,
    basePrice,
    hourlyRate,
    minimumHours: num(d.minimumHours ?? d.minHours),
    maximumHours: num(d.maximumHours ?? d.maxHours),
    hourIncrement: num(d.hourIncrement ?? d.durationStepHours) ?? 0.5,
    startingPrice: priceUnit === 'HOURLY' ? (hourlyRate ?? basePrice) : basePrice,
    currency: typeof d.currency === 'string' ? d.currency : null,
  }
}

/** List the public service catalog. */
export async function listServices(): Promise<CatalogServiceOut[]> {
  const { items } = await generic.listDocs(SERVICE_DEFS, { limit: 200 })
  return items
    .filter((d) => bool(d.isAvailable ?? d.active, true))
    .map((d) => {
      const p = pricingOf(d)
      return CatalogServiceOut.parse({
        id: str(d.id),
        title: str(d.title ?? d.name, 'Service'),
        description: typeof d.description === 'string' ? d.description : null,
        basePrice: p.basePrice,
        hourlyRate: p.hourlyRate,
        minimumHours: p.minimumHours,
        priceUnit: p.priceUnit,
        startingPrice: p.startingPrice,
        currency: p.currency,
        isAvailable: bool(d.isAvailable ?? d.active, true),
      })
    })
}

/**
 * Everything the Duration & Extras screen needs in one call.
 * The totals still come from POST /v1/bookings/quote — this only supplies the
 * inputs the picker is built from.
 */
export async function getServicePricing(serviceId: string): Promise<ServicePricingOut> {
  const doc = await generic.getDocById(SERVICE_DEFS, serviceId)
  if (!doc) throw notFound('Service not found')

  const p = pricingOf(doc)
  const extras = await listServiceExtras(serviceId)

  return ServicePricingOut.parse({
    serviceId,
    title: str(doc.title ?? doc.name, 'Service'),
    priceUnit: p.priceUnit,
    basePrice: p.basePrice,
    hourlyRate: p.hourlyRate,
    minimumHours: p.minimumHours,
    hourIncrement: p.hourIncrement,
    maximumHours: p.maximumHours,
    currency: p.currency,
    extras,
    quotePath: '/api/v1/bookings/quote',
  })
}

/**
 * List add-ons/extras for a service. `addon_catalog` docs may or may not carry a
 * service link. A doc with NO link is treated as a global add-on (applies to
 * every service); a linked doc is included only when its link matches this
 * service. So an all-unlinked catalog returns everything, an all-linked catalog
 * returns only matches, and a mixed catalog returns globals + matches.
 */
export async function listServiceExtras(serviceId: string): Promise<ServiceExtraOut[]> {
  const { items } = await generic.listDocs(ADDON_CATALOG, { limit: 200 })
  return items
    .filter((d) => {
      const link = d.serviceId ?? d.serviceDefinitionId ?? d.service_id
      return link == null || link === serviceId
    })
    .filter((d) => bool(d.isAvailable ?? d.active, true))
    .map((d) =>
      ServiceExtraOut.parse({
        id: str(d.id),
        title: str(d.title ?? d.name, 'Add-on'),
        price: num(d.price) ?? 0,
        isAvailable: bool(d.isAvailable ?? d.active, true),
      }),
    )
}
