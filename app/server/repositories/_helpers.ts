import { ObjectId } from 'mongodb'

/**
 * Shared repository helpers for ObjectId <-> string conversion at the boundary.
 * See: docs/migration/02-data-model.md
 */

export function toObjectId(id: string): ObjectId | string {
  return ObjectId.isValid(id) ? new ObjectId(id) : id
}

export function idFilter(id: string): Record<string, unknown> {
  return { _id: toObjectId(id) }
}

/** Map a Mongo document to a plain object exposing `id: string` instead of `_id`. */
export function fromDoc(doc: unknown): Record<string, unknown> {
  const { _id, ...rest } = (doc ?? {}) as Record<string, unknown>
  return { id: _id != null ? String(_id) : undefined, ...rest }
}
