import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ObjectId } from 'mongodb'

/**
 * Query-filter construction for the monitoring list endpoints.
 *
 * `AdminListQuery` only ever declared `limit`/`skip`/`search`, and Zod objects drop
 * undeclared keys silently — so `/monitoring/alerts`, `/monitoring/alerts/sla` and
 * `/monitoring/audit/history` accepted a filter panel's worth of params and ignored
 * every one of them. These tests pin the repo layer's translation of those params
 * into Mongo filters.
 *
 * The repo is the only layer that builds queries, so it's tested directly: `getDb`
 * is faked and the assertions are on the filter/sort the repo hands to the driver.
 * That is real production behaviour — the query document itself — not mock behaviour.
 */

interface RecordedCall {
  filter?: Record<string, unknown>
  sort?: Record<string, number>
  skip?: number
  limit?: number
  countFilter?: Record<string, unknown>
}

const recorded: RecordedCall = {}

function resetRecorded() {
  delete recorded.filter
  delete recorded.sort
  delete recorded.skip
  delete recorded.limit
  delete recorded.countFilter
}

vi.mock('@/server/core/mongo', () => ({
  getDb: () => ({
    collection: () => ({
      find(filter: Record<string, unknown>) {
        recorded.filter = filter
        const cursor = {
          sort(s: Record<string, number>) {
            recorded.sort = s
            return cursor
          },
          skip(n: number) {
            recorded.skip = n
            return cursor
          },
          limit(n: number) {
            recorded.limit = n
            return cursor
          },
          async toArray() {
            return []
          },
        }
        return cursor
      },
      async countDocuments(filter: Record<string, unknown>) {
        recorded.countFilter = filter
        return 0
      },
    }),
  }),
}))

import * as repo from '@/server/repositories/admin-monitoring-repo'

beforeEach(() => {
  resetRecorded()
})

describe('listAlerts — filter construction', () => {
  it('filters to alerts only when given no params', async () => {
    await repo.listAlerts({})
    expect(recorded.filter).toEqual({ kind: 'alert' })
  })

  it('unreadOnly matches docs where read is not true, not read === false', async () => {
    // Alerts are created without a `read` field; `read: false` would miss them all.
    await repo.listAlerts({ unreadOnly: true })
    expect(recorded.filter).toEqual({ kind: 'alert', read: { $ne: true } })
  })

  it('omits the read filter when unreadOnly is false', async () => {
    await repo.listAlerts({ unreadOnly: false })
    expect(recorded.filter).toEqual({ kind: 'alert' })
  })

  it('maps status=open onto the acknowledged flag', async () => {
    await repo.listAlerts({ status: 'open' })
    expect(recorded.filter).toEqual({ kind: 'alert', acknowledged: { $ne: true } })
  })

  it('maps status=acknowledged onto the acknowledged flag', async () => {
    await repo.listAlerts({ status: 'acknowledged' })
    expect(recorded.filter).toEqual({ kind: 'alert', acknowledged: true })
  })

  it('combines status and unreadOnly', async () => {
    await repo.listAlerts({ status: 'open', unreadOnly: true })
    expect(recorded.filter).toEqual({
      kind: 'alert',
      acknowledged: { $ne: true },
      read: { $ne: true },
    })
  })

  it('still narrows to SLA alerts via slaOnly', async () => {
    await repo.listAlerts({ slaOnly: true })
    expect(recorded.filter).toEqual({ kind: 'alert', alertType: 'SLA' })
  })

  it('applies an hours window against dateCreated', async () => {
    const before = Math.floor(Date.now() / 1000) - 24 * 3600
    await repo.listAlerts({ slaOnly: true, hours: 24 })
    const after = Math.floor(Date.now() / 1000) - 24 * 3600

    const range = recorded.filter?.dateCreated as { $gte: number }
    expect(range.$gte).toBeGreaterThanOrEqual(before)
    expect(range.$gte).toBeLessThanOrEqual(after)
    expect(recorded.filter?.alertType).toBe('SLA')
  })

  it('counts with the same filter it queries with', async () => {
    await repo.listAlerts({ unreadOnly: true })
    expect(recorded.countFilter).toEqual(recorded.filter)
  })
})

describe('listAuditEvents — filter construction', () => {
  it('filters to audit events only when given no params', async () => {
    await repo.listAuditEvents({})
    expect(recorded.filter).toEqual({ kind: 'audit_event' })
  })

  it('applies each scalar filter as an equality match', async () => {
    await repo.listAuditEvents({
      actorId: 'admin-1',
      targetId: 'cust-9',
      endpoint: '/api/v1/admins',
      eventType: 'PERMISSION_DENIED',
      status: 'failed',
      severity: 'critical',
    })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      actorId: 'admin-1',
      targetId: 'cust-9',
      endpoint: '/api/v1/admins',
      eventType: 'PERMISSION_DENIED',
      status: 'failed',
      severity: 'critical',
    })
  })

  it('ignores filters that are empty strings', async () => {
    await repo.listAuditEvents({ actorId: '', severity: '' })
    expect(recorded.filter).toEqual({ kind: 'audit_event' })
  })

  it('requires every requested tag to be present', async () => {
    await repo.listAuditEvents({ tags: ['auth', 'admin'] })
    expect(recorded.filter).toEqual({ kind: 'audit_event', tags: { $all: ['auth', 'admin'] } })
  })

  it('ignores an empty tag list', async () => {
    await repo.listAuditEvents({ tags: [] })
    expect(recorded.filter).toEqual({ kind: 'audit_event' })
  })

  it('turns fromEpoch/toEpoch into a dateCreated range', async () => {
    await repo.listAuditEvents({ fromEpoch: 1700000000, toEpoch: 1700086400 })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      dateCreated: { $gte: 1700000000, $lte: 1700086400 },
    })
  })

  it('accepts an open-ended lower bound', async () => {
    await repo.listAuditEvents({ fromEpoch: 1700000000 })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      dateCreated: { $gte: 1700000000 },
    })
  })

  it('treats a zero epoch bound as no bound at all', async () => {
    // A blank `to_epoch=` on the wire coerces to 0 (`Number('') === 0`). Honouring
    // that as `$lte: 0` would match nothing — the opposite of "no filter applied",
    // and inconsistent with how blank string filters are dropped.
    await repo.listAuditEvents({ fromEpoch: 0, toEpoch: 0 })
    expect(recorded.filter).toEqual({ kind: 'audit_event' })
  })

  it('keeps a real lower bound when only the upper bound is blank', async () => {
    await repo.listAuditEvents({ fromEpoch: 1700000000, toEpoch: 0 })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      dateCreated: { $gte: 1700000000 },
    })
  })

  it('sorts newest-first by default', async () => {
    await repo.listAuditEvents({})
    expect(recorded.sort).toEqual({ _id: -1 })
  })

  it('sorts oldest-first when sort=asc', async () => {
    await repo.listAuditEvents({ sort: 'asc' })
    expect(recorded.sort).toEqual({ _id: 1 })
  })
})

describe('listAuditEvents — cursor pagination', () => {
  const cursorId = '507f1f77bcf86cd799439011'

  it('pages past the cursor when sorting newest-first', async () => {
    await repo.listAuditEvents({ cursor: cursorId })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      _id: { $lt: new ObjectId(cursorId) },
    })
  })

  it('pages forward from the cursor when sorting oldest-first', async () => {
    await repo.listAuditEvents({ cursor: cursorId, sort: 'asc' })
    expect(recorded.filter).toEqual({
      kind: 'audit_event',
      _id: { $gt: new ObjectId(cursorId) },
    })
  })

  it('ignores a cursor that is not a valid ObjectId', async () => {
    await repo.listAuditEvents({ cursor: 'not-an-object-id' })
    expect(recorded.filter).toEqual({ kind: 'audit_event' })
  })

  it('skips skip-based paging while a cursor is in play', async () => {
    // Mixing the two would drop a page: the cursor already positions the reader.
    await repo.listAuditEvents({ cursor: cursorId, skip: 40 })
    expect(recorded.skip).toBe(0)
  })

  it('still applies skip when there is no cursor', async () => {
    await repo.listAuditEvents({ skip: 40 })
    expect(recorded.skip).toBe(40)
  })

  it('counts the whole matching set, not just what is left after the cursor', async () => {
    // `total` drives the UI's result count. Counting with the cursor bound applied
    // would make it shrink on every page turn.
    await repo.listAuditEvents({ cursor: cursorId, severity: 'critical' })
    expect(recorded.countFilter).toEqual({ kind: 'audit_event', severity: 'critical' })
    expect(recorded.filter).toHaveProperty('_id')
  })
})
