import { describe, expect, it } from 'vitest'
import { canReschedule, computeCancellation } from '@/server/services/cancellation-policy'

const NOW = 1_750_000_000
const HOUR = 3600

describe('computeCancellation', () => {
  it('charges nothing when no cleaner has accepted yet', () => {
    const out = computeCancellation({ schedule: NOW + HOUR, now: NOW, price: 100, wasAccepted: false })
    expect(out.policy).toBe('UNACCEPTED')
    expect(out.fee).toBe(0)
    expect(out.refund).toBe(100)
  })

  it('is free more than 24h out', () => {
    const out = computeCancellation({ schedule: NOW + 30 * HOUR, now: NOW, price: 100, wasAccepted: true })
    expect(out.policy).toBe('FREE')
    expect(out.fee).toBe(0)
  })

  it('charges 25% inside 24h', () => {
    const out = computeCancellation({ schedule: NOW + 5 * HOUR, now: NOW, price: 100, wasAccepted: true })
    expect(out.policy).toBe('LATE')
    expect(out.fee).toBe(25)
    expect(out.refund).toBe(75)
  })

  it('charges 50% inside 2h', () => {
    const out = computeCancellation({ schedule: NOW + HOUR, now: NOW, price: 80, wasAccepted: true })
    expect(out.policy).toBe('VERY_LATE')
    expect(out.fee).toBe(40)
  })

  it('charges the full price after the start time', () => {
    const out = computeCancellation({ schedule: NOW - HOUR, now: NOW, price: 60, wasAccepted: true })
    expect(out.policy).toBe('NO_SHOW')
    expect(out.fee).toBe(60)
    expect(out.refund).toBe(0)
  })

  it('treats the 24h boundary as free', () => {
    const out = computeCancellation({ schedule: NOW + 24 * HOUR, now: NOW, price: 100, wasAccepted: true })
    expect(out.policy).toBe('FREE')
  })

  it('handles a booking with no price', () => {
    const out = computeCancellation({ schedule: NOW + HOUR, now: NOW, price: null, wasAccepted: true })
    expect(out.fee).toBe(0)
    expect(out.refund).toBe(0)
  })
})

describe('canReschedule', () => {
  it('rejects a new time in the past', () => {
    const out = canReschedule({ schedule: NOW + 48 * HOUR, newSchedule: NOW - HOUR, now: NOW })
    expect(out.allowed).toBe(false)
  })

  it('rejects inside the 2h cutoff', () => {
    const out = canReschedule({ schedule: NOW + HOUR, newSchedule: NOW + 48 * HOUR, now: NOW })
    expect(out.allowed).toBe(false)
  })

  it('allows a valid move', () => {
    const out = canReschedule({ schedule: NOW + 48 * HOUR, newSchedule: NOW + 72 * HOUR, now: NOW })
    expect(out.allowed).toBe(true)
  })
})
