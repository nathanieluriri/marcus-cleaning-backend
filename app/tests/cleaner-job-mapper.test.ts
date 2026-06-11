import { describe, expect, it } from 'vitest'
import { CleanerJobOut, mapBookingToCleanerJob } from '@/server/schemas/cleaner-job'
import type { BookingOut } from '@/server/schemas/booking'

const booking = {
  id: 'b1',
  customer_id: 'cust1',
  cleaner_id: null,
  serviceId: 'svc1',
  place_id: 'ChIJ_addr',
  status: 'PENDING',
  schedule: 1750000000,
  addons: [],
  notes: 'Gate code 1234',
  price: 80,
  currency: 'USD',
  payment_id: null,
  payment_status: 'UNPAID',
  rating: null,
  acceptedAt: null,
  completedAt: null,
  acknowledgedAt: null,
  dateCreated: 1,
  lastUpdated: 1,
} as unknown as BookingOut

describe('mapBookingToCleanerJob', () => {
  it('maps a booking + context into a CleanerJob shape', () => {
    const job = mapBookingToCleanerJob(booking, { title: 'Deep clean', clientName: 'Ada L', address: '12 Main St' })
    expect(job).toMatchObject({
      id: 'b1',
      title: 'Deep clean',
      clientName: 'Ada L',
      address: '12 Main St',
      price: 80,
      scheduledAt: 1750000000,
      status: 'PENDING',
      notes: 'Gate code 1234',
    })
    expect(job.distanceMiles).toBeNull()
    expect(job.isPriority).toBe(false)
    expect(() => CleanerJobOut.parse(job)).not.toThrow()
  })

  it('falls back to place_id when no address is provided', () => {
    const job = mapBookingToCleanerJob(booking, { title: 'Cleaning', clientName: 'Customer', address: null })
    expect(job.address).toBe('ChIJ_addr')
  })
})
