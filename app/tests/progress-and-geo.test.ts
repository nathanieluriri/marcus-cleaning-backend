import { describe, expect, it } from 'vitest'
import { deriveProgressState, durationOf } from '@/server/schemas/job-session'
import { distanceMiles, toCoordinates } from '@/server/services/geo'

describe('deriveProgressState', () => {
  it('is PENDING before a cleaner accepts', () => {
    expect(deriveProgressState({ bookingStatus: 'PENDING' })).toEqual({ state: 'PENDING', percent: 0 })
  })

  it('is SCHEDULED once accepted with no session yet', () => {
    expect(deriveProgressState({ bookingStatus: 'ACCEPTED' })).toEqual({ state: 'SCHEDULED', percent: 10 })
  })

  it('reports EN_ROUTE to the customer', () => {
    const out = deriveProgressState({ bookingStatus: 'ACCEPTED', sessionStatus: 'EN_ROUTE' })
    expect(out.state).toBe('EN_ROUTE')
    expect(out.percent).toBeGreaterThan(10)
  })

  it('reports IN_PROGRESS to the customer — the gap the frontend reported', () => {
    const out = deriveProgressState({ bookingStatus: 'ACCEPTED', sessionStatus: 'IN_PROGRESS' })
    expect(out.state).toBe('IN_PROGRESS')
    expect(out.percent).toBe(65)
  })

  it('is COMPLETED when the booking is completed even without a session', () => {
    expect(deriveProgressState({ bookingStatus: 'COMPLETED' }).state).toBe('COMPLETED')
  })

  it('treats acknowledged as completed', () => {
    expect(deriveProgressState({ bookingStatus: 'ACKNOWLEDGED' }).state).toBe('COMPLETED')
  })

  it('lets cancellation win over any session state', () => {
    const out = deriveProgressState({ bookingStatus: 'CANCELLED', sessionStatus: 'IN_PROGRESS' })
    expect(out).toEqual({ state: 'CANCELLED', percent: 0 })
  })

  it('advances monotonically through the happy path', () => {
    const seq = [
      deriveProgressState({ bookingStatus: 'PENDING' }).percent,
      deriveProgressState({ bookingStatus: 'ACCEPTED' }).percent,
      deriveProgressState({ bookingStatus: 'ACCEPTED', sessionStatus: 'EN_ROUTE' }).percent,
      deriveProgressState({ bookingStatus: 'ACCEPTED', sessionStatus: 'IN_PROGRESS' }).percent,
      deriveProgressState({ bookingStatus: 'COMPLETED', sessionStatus: 'COMPLETED' }).percent,
    ]
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1])
  })
})

describe('durationOf with en-route sessions', () => {
  it('counts no working time while only en route (startedAt 0)', () => {
    expect(durationOf({ startedAt: 0, completedAt: null }, 1_750_000_000)).toBe(0)
  })

  it('counts from the real start once work begins', () => {
    expect(durationOf({ startedAt: 1_750_000_000 - 900, completedAt: null }, 1_750_000_000)).toBe(900)
  })
})

describe('geo', () => {
  // Central London -> Greenwich is roughly 5.5 miles.
  const london = { latitude: 51.5074, longitude: -0.1278 }
  const greenwich = { latitude: 51.4826, longitude: 0.0077 }

  it('measures a known short distance', () => {
    const d = distanceMiles(london, greenwich)
    expect(d).toBeGreaterThan(5)
    expect(d).toBeLessThan(7)
  })

  it('is zero for the same point', () => {
    expect(distanceMiles(london, london)).toBe(0)
  })

  it('is symmetric', () => {
    expect(distanceMiles(london, greenwich)).toBe(distanceMiles(greenwich, london))
  })

  it('rejects unset and out-of-range coordinates', () => {
    expect(toCoordinates(0, 0)).toBeNull()
    expect(toCoordinates(null, 5)).toBeNull()
    expect(toCoordinates(91, 5)).toBeNull()
    expect(toCoordinates(undefined, undefined)).toBeNull()
  })

  it('accepts real coordinates', () => {
    expect(toCoordinates(51.5074, -0.1278)).toEqual(london)
  })
})
