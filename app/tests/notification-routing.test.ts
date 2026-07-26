import { describe, expect, it, beforeEach } from 'vitest'
import {
  NotificationChannel,
  NotificationSound,
  buildRoute,
  isMarketingType,
  knownNotificationTypes,
  navigationFor,
  routingFor,
} from '@/server/services/notification-routing'
import { batchOf } from '@/server/repositories/broadcast-repo'
import { __resetSettingsCache } from '@/server/core/settings'

beforeEach(() => {
  __resetSettingsCache()
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'
})

describe('routingFor', () => {
  it('puts job events on the jobs channel with the sweeping sound', () => {
    const entry = routingFor('job.started')
    expect(entry.channelId).toBe(NotificationChannel.JOBS)
    expect(entry.sound).toBe(NotificationSound.SWEEPING)
  })

  it('versions every channel id, so a sound can be changed later', () => {
    // A channel's sound is immutable once created on Android, so an
    // unversioned id would be a one-way door.
    for (const id of Object.values(NotificationChannel)) {
      expect(id).toMatch(/_v\d+$/)
    }
  })

  it('marks promo.broadcast as the only marketing type', () => {
    expect(isMarketingType('promo.broadcast')).toBe(true)
    for (const t of ['booking.cancelled', 'job.started', 'payout.failed', 'sos.raised', 'chat.message']) {
      expect(isMarketingType(t)).toBe(false)
    }
  })

  it('collapses chat notifications per conversation', () => {
    expect(routingFor('chat.message').collapseKey).toBe('conversationId')
  })

  it('keeps SOS on its own channel with the system sound, not a promo sound', () => {
    const entry = routingFor('sos.raised')
    expect(entry.channelId).toBe(NotificationChannel.SAFETY)
    expect(entry.sound).toBe(NotificationSound.DEFAULT)
  })

  it('routes promos to the promos channel', () => {
    expect(routingFor('promo.broadcast').channelId).toBe(NotificationChannel.PROMOS)
  })

  it('falls back to general for an unknown type', () => {
    const entry = routingFor('something.invented')
    expect(entry.channelId).toBe(NotificationChannel.GENERAL)
    expect(entry.route).toBeNull()
  })

  it('handles null and undefined types', () => {
    expect(routingFor(null).channelId).toBe(NotificationChannel.GENERAL)
    expect(routingFor(undefined).channelId).toBe(NotificationChannel.GENERAL)
  })

  it('covers every payout lifecycle event', () => {
    const types = knownNotificationTypes()
    expect(types).toContain('payout.requested')
    expect(types).toContain('payout.paid')
    expect(types).toContain('payout.failed')
  })
})

describe('buildRoute', () => {
  it('substitutes placeholders from the payload', () => {
    expect(buildRoute('/bookings/:bookingId', { bookingId: 'abc123' })).toBe('/bookings/abc123')
  })

  it('substitutes several placeholders', () => {
    const out = buildRoute('/chat/:conversationId/m/:sequence', { conversationId: 'c1', sequence: 7 })
    expect(out).toBe('/chat/c1/m/7')
  })

  it('returns null when a placeholder has no value — a half-built route would misnavigate', () => {
    expect(buildRoute('/bookings/:bookingId', {})).toBeNull()
    expect(buildRoute('/bookings/:bookingId', { bookingId: '' })).toBeNull()
    expect(buildRoute('/bookings/:bookingId', { bookingId: null })).toBeNull()
  })

  it('returns null for an unconfigured (null) template', () => {
    expect(buildRoute(null, { bookingId: 'abc' })).toBeNull()
  })

  it('url-encodes substituted values', () => {
    expect(buildRoute('/q/:term', { term: 'a b/c' })).toBe('/q/a%20b%2Fc')
  })
})

describe('navigationFor', () => {
  it('always supplies a channel and sound, even with routes unconfigured', () => {
    const nav = navigationFor('job.started', { bookingId: 'b1' })
    expect(nav.channelId).toBe(NotificationChannel.JOBS)
    expect(nav.sound).toBe(NotificationSound.SWEEPING)
  })

  it('emits structured entity refs so the app can route without a URL', () => {
    const nav = navigationFor('job.started', { bookingId: 'b1' })
    expect(nav.entityType).toBe('booking')
    expect(nav.entityId).toBe('b1')
  })

  it('resolves the customer route and deep link', () => {
    const nav = navigationFor('job.started', { bookingId: 'b1' }, 'customer')
    expect(nav.route).toBe('/bookings/b1')
    expect(nav.deepLink).toBe('marcuscleaning://bookings/b1')
  })

  it('uses the staff route where the same event lands elsewhere', () => {
    const customer = navigationFor('booking.cancelled', { bookingId: 'b1' }, 'customer')
    const cleaner = navigationFor('booking.cancelled', { bookingId: 'b1' }, 'cleaner')
    expect(customer.route).toBe('/bookings/b1')
    // Not /jobs/request/:id — that screen offers accept/decline on a dead job.
    expect(cleaner.route).toBe('/jobs')
  })

  it('omits the route for a staff screen that does not exist yet', () => {
    const nav = navigationFor('chat.message', { conversationId: 'c1' }, 'cleaner')
    expect(nav.route).toBeUndefined()
    // The structured reference is still present, so it works the day the screen lands.
    expect(nav.entityId).toBe('c1')
  })

  it('passes the collapse key through for chat', () => {
    expect(navigationFor('chat.message', { conversationId: 'c1' }).collapseKey).toBe('c1')
  })

  it('omits entityId when the id is absent from the payload', () => {
    expect(navigationFor('job.started', {}).entityId).toBeUndefined()
  })

  it('omits the route when its placeholder cannot be filled', () => {
    expect(navigationFor('job.started', {}).route).toBeUndefined()
  })

  it('uses the conversation id for chat messages', () => {
    const nav = navigationFor('chat.message', { conversationId: 'c9', bookingId: 'b1' })
    expect(nav.entityType).toBe('conversation')
    expect(nav.entityId).toBe('c9')
  })
})

describe('batchOf — resumable broadcast fan-out', () => {
  const recipients = Array.from({ length: 10 }, (_, i) => ({
    userId: `u${i}`,
    role: 'customer' as const,
  }))

  it('returns the first slice when nothing is processed', () => {
    expect(batchOf(recipients, 0, 4).map((r) => r.userId)).toEqual(['u0', 'u1', 'u2', 'u3'])
  })

  it('resumes from where the previous batch stopped', () => {
    expect(batchOf(recipients, 4, 4).map((r) => r.userId)).toEqual(['u4', 'u5', 'u6', 'u7'])
  })

  it('returns a short final batch', () => {
    expect(batchOf(recipients, 8, 4)).toHaveLength(2)
  })

  it('returns empty once everyone is processed — the completion signal', () => {
    expect(batchOf(recipients, 10, 4)).toEqual([])
  })

  it('never re-sends when processed exceeds the list length', () => {
    expect(batchOf(recipients, 25, 4)).toEqual([])
  })
})
