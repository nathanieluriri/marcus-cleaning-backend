import type { Collection, WithId } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import type { DocumentDoc } from '@/server/schemas/document'
import { idFilter } from './_helpers'

/**
 * Data access for the `documents` collection (upload metadata).
 * Ported from `document_repo.py`. Only this layer touches Mongo.
 * See: docs/migration/02-data-model.md
 */

let indexesReady = false

function collection(): Collection<DocumentDoc> {
  return getDb().collection<DocumentDoc>('documents')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ ownerId: 1 }, { name: 'idx_document_owner' })
  await collection().createIndex({ objectKey: 1 }, { name: 'idx_document_object_key', unique: true })
  indexesReady = true
}

export async function insertDocument(doc: DocumentDoc): Promise<WithId<DocumentDoc>> {
  await ensureIndexes()
  const result = await collection().insertOne(doc)
  const stored = await collection().findOne(idFilter(String(result.insertedId)))
  if (!stored) throw new Error('Document insert failed')
  return stored
}

export async function getById(id: string): Promise<WithId<DocumentDoc> | null> {
  await ensureIndexes()
  return collection().findOne(idFilter(id))
}

export async function markUploaded(id: string, size: number | null, lastUpdated: number): Promise<void> {
  await collection().updateOne(idFilter(id), {
    $set: { status: 'UPLOADED', size: size ?? null, lastUpdated },
  })
}

export async function deleteById(id: string): Promise<void> {
  await collection().deleteOne(idFilter(id))
}
