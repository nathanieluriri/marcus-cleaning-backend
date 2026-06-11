import type { Collection, Document, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { idFilter, fromDoc } from './_helpers'

/**
 * Read access to the `customers` and `cleaners` collections for the admin
 * directory endpoints (list / by-id / autocomplete / onboarding queue).
 *
 * This is a thin admin-side reader: it does not own the customer/cleaner write
 * model (those live in customer-repo / cleaner-repo). Only this layer touches
 * Mongo for the admin directory views.
 *
 * See: docs/migration/07-domain-endpoints.md
 */

function customers(): Collection<Document> {
  return getDb().collection<Document>('customers')
}
function cleaners(): Collection<Document> {
  return getDb().collection<Document>('cleaners')
}

export interface DirectoryListResult {
  items: Array<Record<string, unknown>>
  total: number
}

interface ListParams {
  limit?: number
  skip?: number
  search?: string
  filter?: Filter<Document>
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 50, 1), 200)
}

/** Build a case-insensitive search filter across common name/email fields. */
function searchFilter(search?: string): Filter<Document> {
  if (!search) return {}
  const rx = { $regex: search, $options: 'i' }
  return {
    $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }],
  } as Filter<Document>
}

async function listFrom(coll: Collection<Document>, params: ListParams): Promise<DirectoryListResult> {
  const limit = clampLimit(params.limit)
  const skip = Math.max(params.skip ?? 0, 0)
  const filter = { ...(params.filter ?? {}), ...searchFilter(params.search) } as Filter<Document>
  const [rows, total] = await Promise.all([
    coll.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
    coll.countDocuments(filter),
  ])
  return { items: rows.map(fromDoc), total }
}

// --- customers ---

export function listCustomers(params: ListParams): Promise<DirectoryListResult> {
  return listFrom(customers(), params)
}

export async function getCustomerById(id: string): Promise<Record<string, unknown> | null> {
  const row = await customers().findOne(idFilter(id))
  return row ? fromDoc(row) : null
}

// --- cleaners ---

export function listCleaners(params: ListParams): Promise<DirectoryListResult> {
  return listFrom(cleaners(), params)
}

export async function getCleanerById(id: string): Promise<Record<string, unknown> | null> {
  const row = await cleaners().findOne(idFilter(id))
  return row ? fromDoc(row) : null
}

/** Cleaners pending onboarding review. The exact status field name awaits the
 * ported cleaner model; we match common onboarding-status shapes defensively. */
export function listOnboardingQueue(params: ListParams): Promise<DirectoryListResult> {
  const filter: Filter<Document> = {
    $or: [
      { onboardingStatus: { $in: ['PENDING', 'SUBMITTED', 'IN_REVIEW'] } },
      { onboardingReviewStatus: { $in: ['PENDING', 'SUBMITTED', 'IN_REVIEW'] } },
    ],
  } as Filter<Document>
  return listFrom(cleaners(), { ...params, filter })
}

export async function updateCleanerOnboardingReview(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  await cleaners().updateOne(idFilter(id), {
    $set: { ...data, lastUpdated: Math.floor(Date.now() / 1000) },
  })
  return getCleanerById(id)
}

// --- autocomplete (across customers + cleaners) ---

export interface AutocompleteHit {
  id: string
  type: 'customer' | 'cleaner'
  label: string
  email?: string
}

function toHit(doc: Record<string, unknown>, type: 'customer' | 'cleaner'): AutocompleteHit {
  const first = (doc.firstName as string) ?? ''
  const last = (doc.lastName as string) ?? ''
  const label = `${first} ${last}`.trim() || ((doc.email as string) ?? String(doc.id))
  return { id: String(doc.id), type, label, email: doc.email as string | undefined }
}

export async function autocompleteUsers(search: string, limit = 10): Promise<AutocompleteHit[]> {
  const lim = Math.min(Math.max(limit, 1), 50)
  const filter = searchFilter(search)
  const [custRows, cleanRows] = await Promise.all([
    customers().find(filter).limit(lim).toArray(),
    cleaners().find(filter).limit(lim).toArray(),
  ])
  return [
    ...custRows.map((r) => toHit(fromDoc(r), 'customer')),
    ...cleanRows.map((r) => toHit(fromDoc(r), 'cleaner')),
  ].slice(0, lim)
}
