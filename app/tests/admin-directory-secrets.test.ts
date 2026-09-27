import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as repo from '@/server/repositories/admin-directory-repo'

/**
 * The admin directory (customers, cleaners, their by-id reads and the onboarding
 * queue) reads whole account documents, and those carry the bcrypt password
 * hash. Every read must project it out: an operations admin may list cleaners,
 * but must never receive their hashes.
 *
 * Mongo is mocked: each read records the options it was given.
 */

const reads: Array<{ op: string; options: unknown }> = []
const cursor = { sort: () => cursor, skip: () => cursor, limit: () => cursor, toArray: async () => [] }
const collection = {
  find: vi.fn((...args: unknown[]) => {
    reads.push({ op: 'find', options: args[1] })
    return cursor
  }),
  findOne: vi.fn(async (...args: unknown[]) => {
    reads.push({ op: 'findOne', options: args[1] })
    return null
  }),
  countDocuments: vi.fn(async () => 0),
}

vi.mock('@/server/core/mongo', () => ({
  getDb: vi.fn(() => ({ collection: () => collection })),
  getClient: vi.fn(),
}))

const HIDDEN = { projection: { password: 0 } }
const ID = '6a8308a0588daa84d031dc82'

describe('admin directory reads never return password hashes', () => {
  beforeEach(() => {
    reads.length = 0
  })

  it.each([
    { name: 'listCustomers', read: () => repo.listCustomers({}) },
    { name: 'listCleaners', read: () => repo.listCleaners({ search: 'grace' }) },
    { name: 'listOnboardingQueue', read: () => repo.listOnboardingQueue({}) },
  ])('$name projects the hash out', async ({ read }) => {
    await read()
    expect(reads).toEqual([{ op: 'find', options: HIDDEN }])
  })

  it.each([
    { name: 'getCustomerById', read: () => repo.getCustomerById(ID) },
    { name: 'getCleanerById', read: () => repo.getCleanerById(ID) },
  ])('$name projects the hash out', async ({ read }) => {
    await read()
    expect(reads).toEqual([{ op: 'findOne', options: HIDDEN }])
  })
})
