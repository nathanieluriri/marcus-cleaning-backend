import { notFound } from '@/server/core/errors'
import * as savedAddressRepo from '@/server/repositories/saved-address-repo'
import type { SavedAddressDoc, SavedAddressOut, SavedAddressCreate, SavedAddressUpdate } from '@/server/schemas/saved-address'

/**
 * Saved-address business logic. No HTTP types here (cron/tests can reuse).
 *
 * Addresses are created from a `place_id`; the server resolves the place
 * details. The Places service is owned by another agent and built separately,
 * so detail resolution is STUBBED here (see `resolvePlace`) — wire it up to the
 * real place-service once available.
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

interface ResolvedPlace {
  formattedAddress: string | null
  line1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * STUB: resolve a Google place_id to address detail fields.
 *
 * The real implementation belongs to the place-service (built by another
 * agent). We deliberately do NOT import it here to avoid a cross-agent coupling
 * / circular wiring. When place-service lands, replace the body with a call to
 * its `getDetails(placeId)` and map the result onto ResolvedPlace.
 */
async function resolvePlace(_placeId: string): Promise<ResolvedPlace> {
  return {
    formattedAddress: null,
    line1: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    latitude: null,
    longitude: null,
  }
}

export async function list(customerId: string): Promise<SavedAddressOut[]> {
  return savedAddressRepo.listByCustomer(customerId)
}

export async function create(customerId: string, payload: SavedAddressCreate): Promise<SavedAddressOut> {
  const ts = nowEpoch()
  const resolved = await resolvePlace(payload.place_id)
  const doc: SavedAddressDoc = {
    customerId,
    placeId: payload.place_id,
    label: payload.label ?? null,
    formattedAddress: resolved.formattedAddress,
    line1: resolved.line1,
    line2: payload.line2 ?? null,
    city: resolved.city,
    state: resolved.state,
    postalCode: resolved.postalCode,
    country: resolved.country,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    notes: payload.notes ?? null,
    isDefault: payload.isDefault ?? false,
    dateCreated: ts,
    lastUpdated: ts,
  }
  const created = await savedAddressRepo.insertAddress(doc)
  // If created as default, clear the flag on any siblings.
  if (created.isDefault) {
    return (await savedAddressRepo.setDefault(customerId, created.id, ts)) ?? created
  }
  return created
}

export async function update(
  customerId: string,
  addressId: string,
  payload: SavedAddressUpdate,
): Promise<SavedAddressOut> {
  const existing = await savedAddressRepo.findById(customerId, addressId)
  if (!existing) throw notFound('Saved address not found')

  const patch: Partial<SavedAddressDoc> = { lastUpdated: nowEpoch() }
  if (payload.label !== undefined) patch.label = payload.label
  if (payload.line2 !== undefined) patch.line2 = payload.line2
  if (payload.notes !== undefined) patch.notes = payload.notes

  const updated = await savedAddressRepo.updateAddress(customerId, addressId, patch)
  if (!updated) throw notFound('Saved address not found')

  if (payload.isDefault === true) {
    return (await savedAddressRepo.setDefault(customerId, addressId, patch.lastUpdated!)) ?? updated
  }
  return updated
}

export async function remove(customerId: string, addressId: string): Promise<{ deleted: boolean }> {
  const deleted = await savedAddressRepo.deleteAddress(customerId, addressId)
  if (!deleted) throw notFound('Saved address not found')
  return { deleted: true }
}

export async function setDefault(customerId: string, addressId: string): Promise<SavedAddressOut> {
  const updated = await savedAddressRepo.setDefault(customerId, addressId, nowEpoch())
  if (!updated) throw notFound('Saved address not found')
  return updated
}
