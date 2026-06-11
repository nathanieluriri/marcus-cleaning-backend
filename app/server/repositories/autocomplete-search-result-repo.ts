import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { SearchResultOut, type SearchResultOut as SearchResultOutType } from '@/server/schemas/place'
import { fromDoc } from './_helpers'

/**
 * Data access for the `autocomplete_search_result` collection.
 * Ported from `autocomplete_search_result` repo — stores a per-user history of
 * picked autocomplete results. Only this layer touches Mongo.
 * See: docs/migration/02-data-model.md
 */

export interface SearchResultDoc {
  userId: string
  placeId: string
  description: string
  mainText?: string | null
  secondaryText?: string | null
  dateCreated: number
}

let indexesReady = false

function collection(): Collection<SearchResultDoc> {
  return getDb().collection<SearchResultDoc>('autocomplete_search_result')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ userId: 1, dateCreated: -1 }, { name: 'idx_search_user_created' })
  // De-dup the same place per user; keeps history tidy.
  await collection().createIndex({ userId: 1, placeId: 1 }, { name: 'idx_search_user_place', unique: true })
  indexesReady = true
}

/** Upsert a search result so re-picking the same place refreshes its timestamp. */
export async function saveSearchResult(doc: SearchResultDoc): Promise<SearchResultOutType> {
  await ensureIndexes()
  await collection().updateOne(
    { userId: doc.userId, placeId: doc.placeId },
    {
      $set: {
        description: doc.description,
        mainText: doc.mainText ?? null,
        secondaryText: doc.secondaryText ?? null,
        dateCreated: doc.dateCreated,
      },
      $setOnInsert: { userId: doc.userId, placeId: doc.placeId },
    },
    { upsert: true },
  )
  const stored = await collection().findOne({ userId: doc.userId, placeId: doc.placeId })
  return SearchResultOut.parse(fromDoc(stored))
}

/** List a user's search history, most-recent first. */
export async function listSearchHistory(userId: string, limit = 50): Promise<SearchResultOutType[]> {
  await ensureIndexes()
  const rows = await collection()
    .find({ userId })
    .sort({ dateCreated: -1 })
    .limit(limit)
    .toArray()
  return rows.map((r) => SearchResultOut.parse(fromDoc(r)))
}
