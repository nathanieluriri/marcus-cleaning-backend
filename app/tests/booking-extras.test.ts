import { describe, expect, it } from 'vitest'
import { BookingCustomerCreateRequest, resolveAddons } from '@/server/schemas/booking'

describe('booking create extras alias', () => {
  it('accepts an extras string[] alias', () => {
    const req = BookingCustomerCreateRequest.parse({
      serviceId: 'svc1',
      placeId: 'ChIJ',
      schedule: 1750000000,
      extras: ['addon1', 'addon2'],
    })
    expect(req.extras).toEqual(['addon1', 'addon2'])
  })

  it('resolveAddons prefers structured addons when present', () => {
    expect(resolveAddons({ addons: [{ addonId: 'a', quantity: 2 }], extras: ['b'] })).toEqual([
      { addonId: 'a', quantity: 2 },
    ])
  })

  it('resolveAddons maps extras ids to addons when addons empty', () => {
    expect(resolveAddons({ addons: [], extras: ['b', 'c'] })).toEqual([
      { addonId: 'b', quantity: 1 },
      { addonId: 'c', quantity: 1 },
    ])
  })

  it('resolveAddons returns [] when neither given', () => {
    expect(resolveAddons({ addons: [], extras: undefined })).toEqual([])
  })
})
