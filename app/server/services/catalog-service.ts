import * as generic from '@/server/repositories/admin-features/_generic-repo'
import { CatalogServiceOut, ServiceExtraOut } from '@/server/schemas/catalog'

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

/** List the public service catalog. */
export async function listServices(): Promise<CatalogServiceOut[]> {
  const { items } = await generic.listDocs(SERVICE_DEFS, { limit: 200 })
  return items
    .filter((d) => bool(d.isAvailable ?? d.active, true))
    .map((d) =>
      CatalogServiceOut.parse({
        id: str(d.id),
        title: str(d.title ?? d.name, 'Service'),
        description: typeof d.description === 'string' ? d.description : null,
        basePrice: num(d.basePrice ?? d.price),
        isAvailable: bool(d.isAvailable ?? d.active, true),
      }),
    )
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
