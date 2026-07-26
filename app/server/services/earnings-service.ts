import { badRequest, conflict } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import type { AuthPrincipal } from '@/server/security/principal'
import * as sessionRepo from '@/server/repositories/job-session-repo'
import * as payoutRepo from '@/server/repositories/payout-repo'
import * as applicationRepo from '@/server/repositories/cleaner-application-repo'
import { notify } from '@/server/services/notification-dispatch'
import type {
  BalanceOut,
  CashOutRequest,
  EarningsOut,
  EarningsPeriod,
  EarningsPoint,
  PayoutListOut,
  PayoutOut,
} from '@/server/schemas/earnings'

/**
 * Earnings, balance and payouts.
 *
 * Earnings are derived from completed job sessions rather than stored, so the
 * figures can never drift from the jobs that produced them. The available
 * balance is `lifetime earnings - (paid out + in flight)`.
 *
 * Cash-out creates a PENDING payout record; actual money movement is the
 * payment provider's job and is reconciled by cron. Nothing here calls a
 * provider directly — that keeps the request fast and the record authoritative.
 */

const DAY = 86400

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Window for a period, ending at `now`. Buckets are UTC — the client renders
 * labels, so a device in another timezone still gets a coherent series.
 */
export function periodWindow(period: EarningsPeriod, now: number): { from: number; to: number; buckets: number[] } {
  const to = now
  const buckets: number[] = []

  if (period === 'year') {
    const d = new Date(now * 1000)
    // 12 month-starts ending with the current month.
    for (let i = 11; i >= 0; i--) {
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1) / 1000
      buckets.push(start)
    }
    return { from: buckets[0], to, buckets }
  }

  const days = period === 'week' ? 7 : 30
  const todayStart = Math.floor(now / DAY) * DAY
  for (let i = days - 1; i >= 0; i--) buckets.push(todayStart - i * DAY)
  return { from: buckets[0], to, buckets }
}

function bucketIndex(at: number, buckets: number[]): number {
  // Buckets are ascending; find the last one that starts at or before `at`.
  for (let i = buckets.length - 1; i >= 0; i--) if (at >= buckets[i]) return i
  return -1
}

function labelFor(period: EarningsPeriod, bucketStart: number): string {
  const d = new Date(bucketStart * 1000)
  if (period === 'year') return MONTH_LABELS[d.getUTCMonth()]
  if (period === 'week') return DAY_LABELS[d.getUTCDay()]
  return String(d.getUTCDate())
}

/** Earnings for a period, with the per-bucket series that drives the bar chart. */
export async function getEarnings(args: {
  principal: AuthPrincipal
  period: EarningsPeriod
}): Promise<EarningsOut> {
  const now = nowEpoch()
  const { from, to, buckets } = periodWindow(args.period, now)

  const sessions = await sessionRepo.completedBetween(args.principal.userId, from, to + 1, now)

  const series: EarningsPoint[] = buckets.map((at) => ({
    at,
    label: labelFor(args.period, at),
    amount: 0,
    jobs: 0,
  }))

  let total = 0
  let seconds = 0
  let currency: string | null = null

  for (const s of sessions) {
    const amount = s.payout ?? 0
    total += amount
    seconds += s.durationSeconds
    currency ??= s.currency

    const idx = bucketIndex(s.completedAt ?? from, buckets)
    if (idx >= 0) {
      series[idx].amount = round2(series[idx].amount + amount)
      series[idx].jobs += 1
    }
  }

  const jobsCompleted = sessions.length
  return {
    period: args.period,
    from,
    to,
    total: round2(total),
    jobsCompleted,
    hoursWorked: round2(seconds / 3600),
    averagePerJob: jobsCompleted > 0 ? round2(total / jobsCompleted) : 0,
    currency,
    series,
  }
}

/** Lifetime earnings across every completed session. */
async function lifetimeEarnings(cleanerId: string, now: number): Promise<{ total: number; currency: string | null }> {
  const sessions = await sessionRepo.completedBetween(cleanerId, 0, now + 1, now)
  let total = 0
  let currency: string | null = null
  for (const s of sessions) {
    total += s.payout ?? 0
    currency ??= s.currency
  }
  return { total: round2(total), currency }
}

/**
 * The next automatic payout date: weekly, every Friday 00:00 UTC.
 * Exposed as data rather than baked into the app so the cadence can change.
 */
export function nextScheduledPayout(now: number): number {
  const dayStart = Math.floor(now / DAY) * DAY
  const dow = new Date(dayStart * 1000).getUTCDay() // 0 = Sunday, 5 = Friday
  const daysAhead = (5 - dow + 7) % 7 || 7
  return dayStart + daysAhead * DAY
}

export async function getBalance(principal: AuthPrincipal): Promise<BalanceOut> {
  const now = nowEpoch()
  const settings = getSettings()

  const [{ total: earned, currency }, paidOut, inFlight] = await Promise.all([
    lifetimeEarnings(principal.userId, now),
    payoutRepo.sumByStatus(principal.userId, ['PAID']),
    payoutRepo.sumByStatus(principal.userId, ['PENDING', 'PROCESSING']),
  ])

  const available = round2(Math.max(0, earned - paidOut - inFlight))
  return {
    available,
    pending: round2(inFlight),
    lifetimeEarnings: earned,
    lifetimePaidOut: round2(paidOut),
    currency,
    nextPayoutAt: nextScheduledPayout(now),
    cashOutMinimum: settings.PAYOUT_CASH_OUT_MIN,
    cashOutFee: settings.PAYOUT_CASH_OUT_FEE,
    canCashOut: available >= settings.PAYOUT_CASH_OUT_MIN,
  }
}

export async function listPayouts(args: {
  principal: AuthPrincipal
  cursor?: string
  pageSize?: number
}): Promise<PayoutListOut> {
  return payoutRepo.listForCleaner({
    cleanerId: args.principal.userId,
    cursor: args.cursor,
    pageSize: args.pageSize,
  })
}

/**
 * Request an instant cash-out. Creates a PENDING payout that reserves the
 * amount against the balance; cron settles it with the provider.
 *
 * Guarded three ways: payout details must exist, the amount must clear the
 * minimum, and it must not exceed what is actually available.
 */
export async function requestCashOut(args: {
  principal: AuthPrincipal
  payload: CashOutRequest
}): Promise<PayoutOut> {
  const settings = getSettings()
  const balance = await getBalance(args.principal)

  const application = await applicationRepo.findByCleanerId(args.principal.userId)
  if (!application?.payoutDetails) {
    throw badRequest('Add your payout details before cashing out', {
      code: 'PAYOUT_DETAILS_MISSING',
    })
  }

  const amount = round2(args.payload.amount ?? balance.available)
  if (amount <= 0) throw badRequest('There is nothing available to cash out')
  if (amount < settings.PAYOUT_CASH_OUT_MIN) {
    throw badRequest(`The minimum cash-out is ${settings.PAYOUT_CASH_OUT_MIN}`, {
      minimum: settings.PAYOUT_CASH_OUT_MIN,
      requested: amount,
    })
  }
  if (amount > balance.available) {
    // 409 rather than 400: the request is well-formed, the state disallows it.
    throw conflict('That is more than your available balance', {
      available: balance.available,
      requested: amount,
    })
  }

  const now = nowEpoch()
  const fee = settings.PAYOUT_CASH_OUT_FEE
  const payout = await payoutRepo.insert({
    cleanerId: args.principal.userId,
    amount,
    fee,
    netAmount: round2(amount - fee),
    currency: balance.currency,
    status: 'PENDING',
    method: 'INSTANT',
    reference: null,
    failureReason: null,
    paidAt: null,
    dateCreated: now,
    lastUpdated: now,
  })

  await notify({
    userId: args.principal.userId,
    role: 'cleaner',
    title: 'Cash-out requested',
    body: `Your cash-out of ${payout.netAmount} is being processed.`,
    type: 'payout.requested',
    data: { payoutId: payout.id, amount: payout.amount },
  })

  return payout
}
