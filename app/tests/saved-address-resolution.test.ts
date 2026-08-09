import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedAddressDoc } from '@/server/schemas/saved-address'

/**
 * Creating a saved address resolves its place_id for coordinates. Resolution is
 * best-effort: a provider outage must not stop the customer saving an address,
 * but it must be loud in the log rather than silently storing nulls.
 */

const resolveAddress = vi.fn()
const insertAddress = vi.fn()

vi.mock('@/server/services/place-service', () => ({
  resolveAddress: (...args: unknown[]) => resolveAddress(...args),
}))

vi.mock('@/server/repositories/saved-address-repo', () => ({
  insertAddress: (...args: unknown[]) => insertAddress(...args),
  setDefault: vi.fn(),
  listByCustomer: vi.fn(),
  findById: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
}))

import { create } from '@/server/services/saved-address-service'

const RESOLVED = {
  formattedAddress: '10 Downing St, London SW1A 2AA, UK',
  line1: '10 Downing Street',
  city: 'London',
  state: 'England',
  postalCode: 'SW1A 2AA',
  country: 'United Kingdom',
  latitude: 51.5034,
  longitude: -0.1276,
}

/** The doc handed to the repo — what actually gets persisted. */
function insertedDoc(): SavedAddressDoc {
  return insertAddress.mock.calls[0][0] as SavedAddressDoc
}

beforeEach(() => {
  resolveAddress.mockReset()
  insertAddress.mockReset()
  insertAddress.mockImplementation(async (doc: SavedAddressDoc) => ({ ...doc, id: 'addr1' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('create — place resolution', () => {
  it('persists the resolved coordinates', async () => {
    resolveAddress.mockResolvedValue(RESOLVED)
    await create('cust1', { place_id: 'ChIJtest' })
    expect(insertedDoc()).toMatchObject({ latitude: 51.5034, longitude: -0.1276, city: 'London' })
  })

  it('still saves the address when the provider fails', async () => {
    resolveAddress.mockRejectedValue(new Error('provider down'))
    const out = await create('cust1', { place_id: 'ChIJtest', label: 'Home' })
    expect(out.id).toBe('addr1')
    expect(insertedDoc()).toMatchObject({ placeId: 'ChIJtest', label: 'Home' })
  })

  it('leaves coordinates null — not zero — when resolution fails', async () => {
    resolveAddress.mockRejectedValue(new Error('provider down'))
    await create('cust1', { place_id: 'ChIJtest' })
    expect(insertedDoc()).toMatchObject({ latitude: null, longitude: null, formattedAddress: null })
  })

  it('logs the failure so degraded saves are not silent', async () => {
    resolveAddress.mockRejectedValue(new Error('provider down'))
    await create('cust1', { place_id: 'ChIJtest' })
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[saved-address]'),
      'ChIJtest',
      expect.any(Error),
    )
  })

  it('keeps client-supplied fields when resolution fails', async () => {
    resolveAddress.mockRejectedValue(new Error('provider down'))
    await create('cust1', { place_id: 'ChIJtest', line2: 'Flat 2', notes: 'ring twice' })
    expect(insertedDoc()).toMatchObject({ line2: 'Flat 2', notes: 'ring twice' })
  })
})
