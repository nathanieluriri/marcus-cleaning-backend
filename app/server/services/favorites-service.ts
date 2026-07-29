import * as extrasRepo from '@/server/repositories/customer-extras-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import { cardFor } from '@/server/services/cleaner-directory-service'
import type { CleanerCardOut } from '@/server/schemas/cleaner-directory'
import { notFound } from '@/server/core/errors'

/**
 * Customer's favorited cleaners. Ids live on the customer doc
 * (`favoriteCleanerIds`); listing hydrates each id into a directory card via
 * `cleaner-directory-service.cardFor`, silently dropping cleaners that no
 * longer exist.
 */

export async function list(customerId: string): Promise<CleanerCardOut[]> {
  const ids = await extrasRepo.getFavoriteCleanerIds(customerId)
  const cards = await Promise.all(ids.map((id) => cardFor(id)))
  return cards.filter((card): card is CleanerCardOut => card !== null)
}

export async function add(customerId: string, cleanerId: string): Promise<void> {
  const cleaner = await cleanerRepo.findById(cleanerId)
  if (!cleaner) throw notFound('Cleaner not found')
  await extrasRepo.addFavorite(customerId, cleanerId)
}

export async function remove(customerId: string, cleanerId: string): Promise<void> {
  await extrasRepo.removeFavorite(customerId, cleanerId)
}
