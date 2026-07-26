import { describe, expect, it } from 'vitest'
import {
  canTransitionApplication,
  missingRequirementsFor,
  type PersonalDetails,
} from '@/server/schemas/cleaner-application'

const complete = {
  personalDetails: { firstName: 'Ada', lastName: 'Lovelace', phone: '+15551234' } as PersonalDetails,
  documents: [{ kind: 'GOVERNMENT_ID' }],
  serviceIds: ['svc1'],
  availability: [{ day: 'mon' as const, start: '09:00', end: '17:00' }],
  payoutDetails: { provider: 'stripe' as const, accountToken: 'acct_1' },
}

describe('missingRequirementsFor', () => {
  it('returns nothing for a complete application', () => {
    expect(missingRequirementsFor(complete)).toEqual([])
  })

  it('flags an empty application', () => {
    const missing = missingRequirementsFor({
      personalDetails: {},
      documents: [],
      serviceIds: [],
      availability: [],
      payoutDetails: null,
    })
    expect(missing).toContain('personalDetails.firstName')
    expect(missing).toContain('documents.GOVERNMENT_ID')
    expect(missing).toContain('serviceIds')
    expect(missing).toContain('availability')
    expect(missing).toContain('payoutDetails')
  })

  it('does not accept a non-ID document as the government ID', () => {
    const missing = missingRequirementsFor({ ...complete, documents: [{ kind: 'CERTIFICATION' }] })
    expect(missing).toEqual(['documents.GOVERNMENT_ID'])
  })
})

describe('application state machine', () => {
  it('allows draft -> submitted', () => {
    expect(canTransitionApplication('DRAFT', 'SUBMITTED')).toBe(true)
  })

  it('blocks editing-to-approved shortcuts', () => {
    expect(canTransitionApplication('DRAFT', 'APPROVED')).toBe(false)
  })

  it('treats approved as terminal', () => {
    expect(canTransitionApplication('APPROVED', 'REJECTED')).toBe(false)
  })

  it('lets a rejected application be reopened for more info', () => {
    expect(canTransitionApplication('REJECTED', 'MORE_INFO_REQUIRED')).toBe(true)
  })

  it('lets a more-info application be resubmitted', () => {
    expect(canTransitionApplication('MORE_INFO_REQUIRED', 'SUBMITTED')).toBe(true)
  })
})
