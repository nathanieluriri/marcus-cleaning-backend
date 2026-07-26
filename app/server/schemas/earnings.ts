import { z } from '@hono/zod-openapi'

/**
 * Cleaner earnings, balance and payouts.
 *
 * Earnings are DERIVED from completed job sessions (`job_sessions.payout`),
 * never stored twice. Payouts are records of money leaving the platform
 * (`payouts` collection); the available balance is earnings minus everything
 * already paid out or in flight.
 */

export const EarningsPeriod = z.enum(['week', 'month', 'year'])
export type EarningsPeriod = z.infer<typeof EarningsPeriod>

/** One bucket of the bar chart: a day for week/month, a month for year. */
export const EarningsPoint = z
  .object({
    /** Bucket start as unix epoch seconds (UTC midnight / month start). */
    at: z.number().int().openapi({ example: 1750000000 }),
    label: z.string().openapi({ example: 'Mon' }),
    amount: z.number().openapi({ example: 120.5 }),
    jobs: z.number().int().openapi({ example: 2 }),
  })
  .openapi('EarningsPoint')
export type EarningsPoint = z.infer<typeof EarningsPoint>

export const EarningsOut = z
  .object({
    period: EarningsPeriod,
    from: z.number().int(),
    to: z.number().int(),
    total: z.number().openapi({ example: 842.25 }),
    jobsCompleted: z.number().int(),
    hoursWorked: z.number().openapi({ example: 31.5 }),
    averagePerJob: z.number(),
    currency: z.string().nullable().default(null),
    series: z.array(EarningsPoint).default([]),
  })
  .openapi('EarningsOut')
export type EarningsOut = z.infer<typeof EarningsOut>

export const BalanceOut = z
  .object({
    /** Earned, not yet paid out or reserved. Withdrawable now. */
    available: z.number().openapi({ example: 320.75 }),
    /** Cash-outs requested but not yet settled. */
    pending: z.number().openapi({ example: 50 }),
    lifetimeEarnings: z.number(),
    lifetimePaidOut: z.number(),
    currency: z.string().nullable().default(null),
    /** Next scheduled automatic payout, unix epoch seconds. */
    nextPayoutAt: z.number().int().nullable().default(null),
    cashOutMinimum: z.number(),
    cashOutFee: z.number(),
    canCashOut: z.boolean(),
  })
  .openapi('BalanceOut')
export type BalanceOut = z.infer<typeof BalanceOut>

export const PayoutStatus = z.enum(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'])
export type PayoutStatus = z.infer<typeof PayoutStatus>

export const PayoutOut = z
  .object({
    id: z.string(),
    cleanerId: z.string(),
    /** Gross amount requested, in major units. */
    amount: z.number(),
    fee: z.number(),
    /** amount - fee: what actually reaches the cleaner. */
    netAmount: z.number(),
    currency: z.string().nullable().default(null),
    status: PayoutStatus,
    method: z.enum(['INSTANT', 'SCHEDULED']),
    reference: z.string().nullable().default(null),
    failureReason: z.string().nullable().default(null),
    paidAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('PayoutOut')
export type PayoutOut = z.infer<typeof PayoutOut>

export const PayoutListOut = z
  .object({
    items: z.array(PayoutOut),
    nextCursor: z.string().nullable().default(null),
    pageSize: z.number().int(),
  })
  .openapi('PayoutListOut')
export type PayoutListOut = z.infer<typeof PayoutListOut>

export const CashOutRequest = z
  .object({
    /** Omit to cash out the full available balance. */
    amount: z.number().positive().nullable().optional().openapi({ example: 100 }),
  })
  .openapi('CashOutRequest')
export type CashOutRequest = z.infer<typeof CashOutRequest>

/** Internal DB document shape for the `payouts` collection. */
export interface PayoutDoc {
  cleanerId: string
  amount: number
  fee: number
  netAmount: number
  currency?: string | null
  status: PayoutStatus
  method: 'INSTANT' | 'SCHEDULED'
  reference?: string | null
  failureReason?: string | null
  paidAt?: number | null
  dateCreated: number
  lastUpdated: number
}
