import { describe, expect, it, vi } from 'vitest'

/**
 * The regression guard for the admin payload drift.
 *
 * CANONICAL docs are what the admin console writes after Batch 2a. LEGACY docs are
 * what it wrote before — kept here deliberately, so the damage is pinned down and
 * the Task 7 migration has an executable definition of what it must repair.
 */
const CANONICAL_SERVICE = {
  id: 'svc-canonical',
  title: 'Deep Clean',
  description: 'Top to bottom.',
  basePrice: 120,
  priceUnit: 'FLAT',
  currency: 'NGN',
  isAvailable: true,
}

const LEGACY_SERVICE = {
  id: 'svc-legacy',
  display_name: 'Deep Clean',
  base_duration_minutes: 120,
  is_active: false,
  notes: 'Top to bottom.',
}

const CANONICAL_ADDON = { id: 'addon-canonical', title: 'Inside oven', price: 20, isAvailable: true }
const LEGACY_ADDON = { id: 'addon-legacy', display_name: 'Inside oven', price_minor: 2000, is_active: true }

vi.mock('@/server/repositories/admin-features/_generic-repo', () => ({
  listDocs: vi.fn(async (collection: string) => {
    if (collection === 'service_definitions') return { items: [CANONICAL_SERVICE, LEGACY_SERVICE], total: 2 }
    if (collection === 'addon_catalog') return { items: [CANONICAL_ADDON, LEGACY_ADDON], total: 2 }
    return { items: [], total: 0 }
  }),
  getDocById: vi.fn(async (collection: string, id: string) => {
    if (collection === 'service_definitions') {
      return [CANONICAL_SERVICE, LEGACY_SERVICE].find((d) => d.id === id) ?? null
    }
    if (collection === 'addon_catalog') {
      return [CANONICAL_ADDON, LEGACY_ADDON].find((d) => d.id === id) ?? null
    }
    return null
  }),
}))

import { listServices, listServiceExtras } from '@/server/services/catalog-service'

describe('canonical admin payloads reach the customer correctly', () => {
  it('a canonical service keeps its real title and price', async () => {
    const services = await listServices()
    const svc = services.find((s) => s.id === 'svc-canonical')
    expect(svc?.title).toBe('Deep Clean')
    expect(svc?.basePrice).toBe(120)
    expect(svc?.startingPrice).toBe(120)
  })

  it('a canonical add-on carries its real price', async () => {
    const extras = await listServiceExtras('svc-canonical')
    const addon = extras.find((e) => e.id === 'addon-canonical')
    expect(addon?.title).toBe('Inside oven')
    expect(addon?.price).toBe(20)
  })
})

describe('legacy admin payloads are broken — this documents the damage', () => {
  it('a legacy service shows as the literal fallback "Service" with no price', async () => {
    const services = await listServices()
    const svc = services.find((s) => s.id === 'svc-legacy')
    expect(svc?.title).toBe('Service')
    expect(svc?.basePrice).toBeNull()
    expect(svc?.startingPrice).toBeNull()
  })

  it('a legacy service marked is_active:false is still shown to customers', async () => {
    const services = await listServices()
    expect(services.some((s) => s.id === 'svc-legacy')).toBe(true)
  })

  it('a legacy add-on prices at zero', async () => {
    const extras = await listServiceExtras('svc-canonical')
    const addon = extras.find((e) => e.id === 'addon-legacy')
    expect(addon?.price).toBe(0)
  })
})
