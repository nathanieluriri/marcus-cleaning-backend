import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as savedAddressRepo from '@/server/repositories/saved-address-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Resolve display fields for bookings (serviceTitle, cleanerName,
 * cleanerAvatarUrl, formattedAddress) so list/detail screens don't need N extra
 * round-trips. Lookups are batched per unique id. Unresolved fields stay null.
 *
 * See: docs/migration backend task #2.
 */

const SERVICE_DEFS = 'service_definitions'

function unique<T>(xs: (T | null | undefined)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x != null && x !== ''))]
}

function addrKey(customerId: string, placeId: string): string {
  return `${customerId}::${placeId}`
}

export async function enrichBookings(items: BookingOut[]): Promise<BookingOut[]> {
  if (items.length === 0) return items

  const cleanerIds = unique(items.map((b) => b.cleaner_id))
  const serviceIds = unique(items.map((b) => b.serviceId))
  const addrPairs = [
    ...new Map(
      items
        .filter((b) => b.place_id)
        .map((b) => [addrKey(b.customer_id, b.place_id), { customerId: b.customer_id, placeId: b.place_id }]),
    ).values(),
  ]

  const cleaners = new Map<string, { name: string | null; avatarUrl: string | null }>()
  const services = new Map<string, string | null>()
  const addresses = new Map<string, string | null>()

  await Promise.all([
    ...cleanerIds.map(async (id) => {
      const doc = await cleanerRepo.findById(id)
      if (!doc) return
      const raw = doc as unknown as Record<string, unknown>
      const name = [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim()
      const avatarUrl = typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null
      cleaners.set(id, { name: name || null, avatarUrl })
    }),
    ...serviceIds.map(async (id) => {
      const doc = await generic.getDocById(SERVICE_DEFS, id)
      if (!doc) return
      const title = doc.title ?? doc.name
      services.set(id, typeof title === 'string' ? title : null)
    }),
    ...addrPairs.map(async ({ customerId, placeId }) => {
      const addr = await savedAddressRepo.findByPlaceId(customerId, placeId)
      if (addr) addresses.set(addrKey(customerId, placeId), addr.formattedAddress ?? addr.label ?? null)
    }),
  ])

  return items.map((b) => ({
    ...b,
    serviceTitle: b.serviceId ? services.get(b.serviceId) ?? null : null,
    cleanerName: b.cleaner_id ? cleaners.get(b.cleaner_id)?.name ?? null : null,
    cleanerAvatarUrl: b.cleaner_id ? cleaners.get(b.cleaner_id)?.avatarUrl ?? null : null,
    formattedAddress: b.place_id ? addresses.get(addrKey(b.customer_id, b.place_id)) ?? null : null,
  }))
}

export async function enrichBooking(b: BookingOut): Promise<BookingOut> {
  const [out] = await enrichBookings([b])
  return out
}
