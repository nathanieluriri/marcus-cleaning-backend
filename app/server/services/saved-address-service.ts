import { notFound } from '@/server/core/errors'
import * as savedAddressRepo from '@/server/repositories/saved-address-repo'
import * as placeService from '@/server/services/place-service'
import type { SavedAddressDoc, SavedAddressOut, SavedAddressCreate, SavedAddressUpdate } from '@/server/schemas/saved-address'

/**
 * Saved-address business logic. No HTTP types here (cron/tests can reuse).
 *
 * Addresses are created from a `place_id`; the server resolves the place
 * details via `place-service.resolveAddress` and stores a snapshot. The stored
 * lat/lng is what cleaner-job distance matching reads.
 *
 * Resolution is best-effort: if the provider is unconfigured or fails we log
 * and save the address with null detail fields rather than blocking the
 * customer from saving it. Such an address yields `distanceMiles: null` on
 * cleaner jobs, and there is currently no backfill — it stays unresolved until
 * the customer saves the address again. Watch the log line below.
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/02-data-model.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

const UNRESOLVED: placeService.ResolvedAddress = {
  formattedAddress: null,
  line1: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  latitude: null,
  longitude: null,
}

/** Resolve a place_id, degrading to null detail fields on provider failure. */
async function resolveOrDegrade(placeId: string): Promise<placeService.ResolvedAddress> {
  try {
    return await placeService.resolveAddress(placeId)
  } catch (err) {
    console.error('[saved-address] place resolution failed; saving without coordinates', placeId, err)
    return UNRESOLVED
  }
}

export async function list(customerId: string): Promise<SavedAddressOut[]> {
  return savedAddressRepo.listByCustomer(customerId)
}

export async function create(customerId: string, payload: SavedAddressCreate): Promise<SavedAddressOut> {
  const ts = nowEpoch()
  const resolved = await resolveOrDegrade(payload.place_id)
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
