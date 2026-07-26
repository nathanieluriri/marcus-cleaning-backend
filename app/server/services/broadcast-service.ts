import { badRequest, notFound } from '@/server/core/errors'
import { getSettings } from '@/server/core/settings'
import type { AuthPrincipal } from '@/server/security/principal'
import * as broadcastRepo from '@/server/repositories/broadcast-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as deviceRepo from '@/server/repositories/device-repo'
import { notify } from '@/server/services/notification-dispatch'
import { isMarketingType } from '@/server/services/notification-routing'
import {
  BroadcastOut,
  type AudiencePreviewOut,
  type BroadcastAudience,
  type BroadcastCreateRequest,
  type BroadcastListOut,
  type BroadcastOut as BroadcastOutType,
  type BroadcastRecipient,
} from '@/server/schemas/broadcast'
import type { BroadcastRow } from '@/server/repositories/broadcast-repo'

/**
 * Admin broadcasts: resolve an audience, preview its size, then fan out.
 *
 * Fan-out is deliberately batched and resumable rather than one big loop. A
 * serverless function can be killed mid-send, and re-running a naive loop would
 * notify everyone twice. Instead the recipient list is frozen on the broadcast
 * at dispatch and `processedCount` advances per batch, so a resumed run picks
 * up exactly where it stopped.
 */

const DAY = 86400

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

// --- audience resolution -----------------------------------------------------

/**
 * Turn an audience definition into a concrete recipient list.
 *
 * Every branch filters to ACTIVE accounts — a broadcast should never wake a
 * deactivated user, and a deleted account has nowhere to deliver.
 */
export async function resolveAudience(audience: BroadcastAudience): Promise<BroadcastRecipient[]> {
  const customers = async (): Promise<BroadcastRecipient[]> =>
    (await customerRepo.listActiveIds()).map((userId) => ({ userId, role: 'customer' as const }))
  const cleaners = async (status?: string): Promise<BroadcastRecipient[]> =>
    (await cleanerRepo.listActiveIds(status)).map((userId) => ({ userId, role: 'cleaner' as const }))

  switch (audience.type) {
    case 'ALL': {
      const [c, cl] = await Promise.all([customers(), cleaners()])
      return [...c, ...cl]
    }

    case 'ALL_CUSTOMERS':
      return customers()

    case 'ALL_CLEANERS':
      return cleaners()

    case 'CLEANERS_BY_ONBOARDING':
      return cleaners(audience.onboardingStatus)

    case 'USER_IDS': {
      const role = audience.role ?? 'customer'
      // Intersect with real active accounts so a stale id list cannot create
      // deliveries to users who no longer exist.
      const active = new Set(
        role === 'cleaner' ? await cleanerRepo.listActiveIds() : await customerRepo.listActiveIds(),
      )
      return (audience.userIds ?? [])
        .filter((id) => active.has(id))
        .map((userId) => ({ userId, role }))
    }

    case 'CUSTOMERS_WITH_BOOKINGS': {
      const [all, booked] = await Promise.all([
        customerRepo.listActiveIds(),
        bookingRepo.distinctCustomerIds(),
      ])
      const bookedSet = new Set(booked)
      return all.filter((id) => bookedSet.has(id)).map((userId) => ({ userId, role: 'customer' as const }))
    }

    case 'CUSTOMERS_NEVER_BOOKED': {
      const [all, booked] = await Promise.all([
        customerRepo.listActiveIds(),
        bookingRepo.distinctCustomerIds(),
      ])
      const bookedSet = new Set(booked)
      return all.filter((id) => !bookedSet.has(id)).map((userId) => ({ userId, role: 'customer' as const }))
    }

    case 'CUSTOMERS_INACTIVE': {
      const days = audience.inactiveDays ?? 30
      const cutoff = nowEpoch() - days * DAY
      const [all, recent] = await Promise.all([
        customerRepo.listActiveIds(),
        bookingRepo.customerIdsActiveSince(cutoff),
      ])
      const recentSet = new Set(recent)
      // "Inactive" includes customers who never booked at all — they are the
      // most obvious win-back target, not an edge case to exclude.
      return all.filter((id) => !recentSet.has(id)).map((userId) => ({ userId, role: 'customer' as const }))
    }

    default:
      throw badRequest('Unsupported audience type', { type: audience.type })
  }
}

/**
 * Dry run: how many people, and how many are actually reachable by push.
 * `type` is accepted so a marketing preview reports the post-opt-out figure
 * rather than a number the real send will never match.
 */
export async function previewAudience(
  audience: BroadcastAudience,
  type = 'promo.broadcast',
): Promise<AudiencePreviewOut> {
  const resolved = await resolveAudience(audience)
  const recipients = await applyMarketingOptOut(type, resolved)
  const customerIds = recipients.filter((r) => r.role === 'customer').map((r) => r.userId)
  const cleanerIds = recipients.filter((r) => r.role === 'cleaner').map((r) => r.userId)

  const [customerReach, cleanerReach] = await Promise.all([
    deviceRepo.countReachable(customerIds, 'customer'),
    deviceRepo.countReachable(cleanerIds, 'cleaner'),
  ])

  return {
    audience,
    total: recipients.length,
    customers: customerIds.length,
    cleaners: cleanerIds.length,
    reachableByPush: customerReach + cleanerReach,
    matchedBeforeOptOut: resolved.length,
    suppressedByOptOut: resolved.length - recipients.length,
  }
}

// --- presentation ------------------------------------------------------------

function present(row: BroadcastRow): BroadcastOutType {
  // `recipients` is an internal implementation detail (and potentially huge);
  // the API exposes counts instead.
  const { recipients: _recipients, ...rest } = row
  void _recipients
  return BroadcastOut.parse(rest)
}

// --- lifecycle ---------------------------------------------------------------

/**
 * Drop recipients who turned marketing off.
 *
 * Applies to marketing types ONLY. Suppressing a transactional notification
 * because someone declined offers would hide a cancelled booking or a failed
 * payout, which is worse than the compliance problem it tries to solve.
 */
async function applyMarketingOptOut(
  type: string,
  recipients: BroadcastRecipient[],
): Promise<BroadcastRecipient[]> {
  if (!isMarketingType(type)) return recipients

  const [customerOptOuts, cleanerOptOuts] = await Promise.all([
    customerRepo.listMarketingOptOutIds(),
    cleanerRepo.listMarketingOptOutIds(),
  ])
  const optedOut = {
    customer: new Set(customerOptOuts),
    cleaner: new Set(cleanerOptOuts),
  }
  return recipients.filter((r) => !optedOut[r.role].has(r.userId))
}

/**
 * Create and queue a broadcast. Recipients are resolved and frozen now, so the
 * audience cannot drift while the send is in flight.
 */
export async function createBroadcast(args: {
  principal: AuthPrincipal
  payload: BroadcastCreateRequest
}): Promise<BroadcastOutType> {
  const resolved = await resolveAudience(args.payload.audience)
  const recipients = await applyMarketingOptOut(args.payload.type, resolved)

  if (recipients.length === 0) {
    throw badRequest(
      resolved.length > 0
        ? 'Everyone in that audience has opted out of marketing notifications'
        : 'That audience matches nobody',
      { audience: args.payload.audience, matched: resolved.length, afterOptOut: 0 },
    )
  }

  const ts = nowEpoch()
  const row = await broadcastRepo.insert({
    title: args.payload.title,
    body: args.payload.body,
    type: args.payload.type,
    audience: args.payload.audience,
    status: 'QUEUED',
    promoId: args.payload.promoId ?? null,
    promoCode: args.payload.promoCode ?? null,
    data: args.payload.data ?? null,
    recipients,
    recipientCount: recipients.length,
    processedCount: 0,
    sentCount: 0,
    failedCount: 0,
    createdBy: args.principal.userId,
    dispatchedAt: ts,
    completedAt: null,
    dateCreated: ts,
    lastUpdated: ts,
  })
  return present(row)
}

/**
 * Process one batch of a queued broadcast.
 *
 * Returns whether more work remains, so the caller (an admin retry or the cron
 * worker) can loop. Each recipient gets an in-app notification row plus a push;
 * `notify` already swallows push failures, so one bad device cannot stall a
 * blast.
 */
export async function processBatch(broadcastId: string): Promise<{
  broadcast: BroadcastOutType
  processed: number
  done: boolean
}> {
  const row = await broadcastRepo.getById(broadcastId)
  if (!row) throw notFound('Broadcast not found')

  if (row.status === 'SENT' || row.status === 'CANCELLED' || row.status === 'FAILED') {
    return { broadcast: present(row), processed: 0, done: true }
  }

  const claimed = await broadcastRepo.claimForSending(broadcastId)
  if (!claimed) {
    // Another worker finished or cancelled it between our read and the claim.
    const latest = await broadcastRepo.getById(broadcastId)
    return { broadcast: present(latest ?? row), processed: 0, done: true }
  }

  const batchSize = getSettings().BROADCAST_BATCH_SIZE
  const batch = broadcastRepo.batchOf(row.recipients, row.processedCount, batchSize)

  if (batch.length === 0) {
    const completed = await broadcastRepo.update(broadcastId, {
      status: 'SENT',
      completedAt: nowEpoch(),
    })
    return { broadcast: present(completed!), processed: 0, done: true }
  }

  const data: Record<string, unknown> = { ...(row.data ?? {}), broadcastId: row.id }
  if (row.promoId) data.promoId = row.promoId
  if (row.promoCode) data.promoCode = row.promoCode

  const results = await Promise.all(
    batch.map(async (recipient) => {
      try {
        await notify({
          userId: recipient.userId,
          role: recipient.role,
          title: row.title,
          body: row.body,
          type: row.type,
          data,
        })
        return true
      } catch (err) {
        // One failed recipient must never abort the blast.
        console.error('[broadcast] delivery failed', row.id, recipient.userId, err)
        return false
      }
    }),
  )

  const sent = results.filter(Boolean).length
  const failed = results.length - sent
  const updated = await broadcastRepo.recordBatch(broadcastId, batch.length, sent, failed)

  const done = (updated?.processedCount ?? 0) >= (updated?.recipientCount ?? 0)
  if (done) {
    const completed = await broadcastRepo.update(broadcastId, {
      status: 'SENT',
      completedAt: nowEpoch(),
    })
    return { broadcast: present(completed!), processed: batch.length, done: true }
  }

  return { broadcast: present(updated!), processed: batch.length, done: false }
}

/** Drain a broadcast, batch after batch. Used by the cron worker. */
export async function processPending(maxBatches = 10): Promise<{ processed: number; broadcasts: number }> {
  const pending = await broadcastRepo.listPending(5)
  let processed = 0

  for (const row of pending) {
    for (let i = 0; i < maxBatches; i++) {
      const result = await processBatch(row.id)
      processed += result.processed
      if (result.done) break
    }
  }
  return { processed, broadcasts: pending.length }
}

export async function getBroadcast(id: string): Promise<BroadcastOutType> {
  const row = await broadcastRepo.getById(id)
  if (!row) throw notFound('Broadcast not found')
  return present(row)
}

export async function listBroadcasts(args: {
  cursor?: string
  pageSize?: number
}): Promise<BroadcastListOut> {
  const result = await broadcastRepo.list(args)
  return { items: result.items.map(present), nextCursor: result.nextCursor, pageSize: result.pageSize }
}

/** Cancel a broadcast that has not finished. Already-sent notifications stay sent. */
export async function cancelBroadcast(id: string): Promise<BroadcastOutType> {
  const row = await broadcastRepo.getById(id)
  if (!row) throw notFound('Broadcast not found')
  if (row.status === 'SENT') throw badRequest('That broadcast has already been sent')

  const updated = await broadcastRepo.update(id, { status: 'CANCELLED', completedAt: nowEpoch() })
  return present(updated!)
}
