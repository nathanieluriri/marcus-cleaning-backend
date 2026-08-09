import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveAddress` is what saved addresses persist their lat/lng from, and that
 * lat/lng is the only input to cleaner-job distance matching. These tests pin
 * the mapping and the failure modes.
 */

vi.mock('@/server/core/settings', () => ({
  getSettings: () => ({ GOOGLE_MAPS_API_KEY: 'test-key' }),
}))

import { resolveAddress } from '@/server/services/place-service'

const GOOGLE_RESULT = {
  status: 'OK',
  result: {
    place_id: 'ChIJtest',
    formatted_address: '10 Downing St, London SW1A 2AA, UK',
    geometry: { location: { lat: 51.5034, lng: -0.1276 } },
    address_components: [
      { long_name: '10', short_name: '10', types: ['street_number'] },
      { long_name: 'Downing Street', short_name: 'Downing St', types: ['route'] },
      { long_name: 'London', short_name: 'London', types: ['locality'] },
      { long_name: 'England', short_name: 'England', types: ['administrative_area_level_1'] },
      { long_name: 'SW1A 2AA', short_name: 'SW1A 2AA', types: ['postal_code'] },
      { long_name: 'United Kingdom', short_name: 'GB', types: ['country'] },
    ],
  },
}

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveAddress', () => {
  it('returns real coordinates — the field distance matching depends on', async () => {
    stubFetch(GOOGLE_RESULT)
    const out = await resolveAddress('ChIJtest')
    expect(out.latitude).toBe(51.5034)
    expect(out.longitude).toBe(-0.1276)
  })

  it('composes line1 from street number + route', async () => {
    stubFetch(GOOGLE_RESULT)
    expect((await resolveAddress('ChIJtest')).line1).toBe('10 Downing Street')
  })

  it('maps the remaining address components', async () => {
    stubFetch(GOOGLE_RESULT)
    expect(await resolveAddress('ChIJtest')).toMatchObject({
      formattedAddress: '10 Downing St, London SW1A 2AA, UK',
      city: 'London',
      state: 'England',
      postalCode: 'SW1A 2AA',
      country: 'United Kingdom',
    })
  })

  it('leaves line1 null when the place has no street address', async () => {
    stubFetch({ status: 'OK', result: { place_id: 'p', address_components: [] } })
    expect((await resolveAddress('p')).line1).toBeNull()
  })

  it('throws rather than returning a null-coordinate address on upstream failure', async () => {
    stubFetch({ status: 'REQUEST_DENIED', error_message: 'bad key' })
    await expect(resolveAddress('ChIJtest')).rejects.toMatchObject({ httpStatus: 502, code: 'PLACES_UPSTREAM_ERROR' })
  })

  it('throws when the place id resolves to nothing', async () => {
    stubFetch({ status: 'ZERO_RESULTS' })
    await expect(resolveAddress('nope')).rejects.toMatchObject({ httpStatus: 400 })
  })
})
