import type { Collection, Document } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter } from './_helpers'

/**
 * Write operations on the `admins` collection that the admin-core suite needs
 * beyond what `admin-repo.ts` (auth) provides: language update and account
 * deletion. Kept separate so the auth repo stays untouched.
 *
 * Only this layer touches Mongo. See: docs/migration/06-services-and-repositories.md
 */

function collection(): Collection<Document> {
  return getDb().collection<Document>('admins')
}

export async function updateLanguage(id: string, language: 'en' | 'fr'): Promise<void> {
  await collection().updateOne(idFilter(id), {
    $set: { preferredLanguage: language, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}

export async function deleteById(id: string): Promise<boolean> {
  const result = await collection().deleteOne(idFilter(id))
  return result.deletedCount > 0
}

export async function getLanguage(id: string): Promise<'en' | 'fr' | null> {
  const row = await collection().findOne(idFilter(id), { projection: { preferredLanguage: 1 } })
  if (!row) return null
  return ((row.preferredLanguage as 'en' | 'fr') ?? 'en')
}
