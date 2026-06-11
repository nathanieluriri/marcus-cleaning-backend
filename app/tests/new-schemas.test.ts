import { describe, expect, it } from 'vitest'
import { CatalogServiceOut, ServiceExtraOut } from '@/server/schemas/catalog'

describe('catalog schemas', () => {
  it('parses a service extra with defaults', () => {
    const e = ServiceExtraOut.parse({ id: 'a1', title: 'Inside oven', price: 20 })
    expect(e).toEqual({ id: 'a1', title: 'Inside oven', price: 20, isAvailable: true })
  })

  it('parses a catalog service with defaults', () => {
    const s = CatalogServiceOut.parse({ id: 's1', title: 'Deep clean' })
    expect(s.isAvailable).toBe(true)
    expect(s.basePrice).toBeNull()
    expect(s.description).toBeNull()
  })
})
