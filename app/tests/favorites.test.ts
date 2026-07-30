import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Favorite cleaners (customer-facing). Repos + `cardFor` are mocked — this is
 * a service-level test, not an integration test against Mongo.
 */

const favoritesStore = new Map<string, Set<string>>()

vi.mock('@/server/repositories/customer-extras-repo', () => ({
  getFavoriteCleanerIds: vi.fn(async (customerId: string) => [...(favoritesStore.get(customerId) ?? [])]),
  addFavorite: vi.fn(async (customerId: string, cleanerId: string) => {
    const set = favoritesStore.get(customerId) ?? new Set<string>()
    set.add(cleanerId)
    favoritesStore.set(customerId, set)
  }),
  removeFavorite: vi.fn(async (customerId: string, cleanerId: string) => {
    favoritesStore.get(customerId)?.delete(cleanerId)
  }),
}))

const knownCleaners = new Set(['cleaner-1', 'cleaner-2', 'cleaner-deleted'])

vi.mock('@/server/repositories/cleaner-repo', () => ({
  findById: vi.fn(async (id: string) => (knownCleaners.has(id) ? { _id: id } : null)),
}))

vi.mock('@/server/services/cleaner-directory-service', () => ({
  cardFor: vi.fn(async (id: string) =>
    id === 'cleaner-deleted'
      ? null
      : { id, name: 'X', rating: 0, jobsDone: 0, hourlyRate: null, isVerified: true, avatarUrl: null, roleLabel: 'Cleaner', yearsExperience: null, bookingsCount: 0, heroImageUrl: null },
  ),
}))

import * as favoritesService from '@/server/services/favorites-service'
import * as extrasRepo from '@/server/repositories/customer-extras-repo'

const customerId = 'customer-1'

beforeEach(() => {
  favoritesStore.clear()
  vi.clearAllMocks()
})

describe('favorites service', () => {
  it('adds a favorite then lists it hydrated as a card', async () => {
    await favoritesService.add(customerId, 'cleaner-1')
    const list = await favoritesService.list(customerId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'cleaner-1', name: 'X' })
  })

  it('throws 404 NOT_FOUND when adding an unknown cleaner', async () => {
    await expect(favoritesService.add(customerId, 'nobody')).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    })
    expect(extrasRepo.addFavorite).not.toHaveBeenCalled()
  })

  it('adding the same cleaner twice results in one entry in the list', async () => {
    await favoritesService.add(customerId, 'cleaner-1')
    await favoritesService.add(customerId, 'cleaner-1')
    const list = await favoritesService.list(customerId)
    expect(list).toHaveLength(1)
  })

  it('remove is idempotent', async () => {
    await favoritesService.add(customerId, 'cleaner-1')
    await favoritesService.remove(customerId, 'cleaner-1')
    await expect(favoritesService.remove(customerId, 'cleaner-1')).resolves.toBeUndefined()
    const list = await favoritesService.list(customerId)
    expect(list).toHaveLength(0)
  })

  it('skips favorites whose cleaner card resolves to null (deleted cleaner)', async () => {
    await favoritesService.add(customerId, 'cleaner-1')
    await favoritesService.add(customerId, 'cleaner-deleted')
    const list = await favoritesService.list(customerId)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('cleaner-1')
  })
})
