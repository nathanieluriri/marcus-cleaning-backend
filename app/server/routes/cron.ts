import { createRouter } from '@/server/core/router'
import { getSettings } from '@/server/core/settings'
import * as paymentService from '@/server/services/payment-service'

/**
 * Vercel Cron handlers (secured by CRON_SECRET, idempotent).
 *
 * Vercel triggers each cron with an HTTP GET to production carrying
 * `Authorization: Bearer ${CRON_SECRET}`. A guard middleware verifies it.
 *
 * These are PLAIN routes (not `.openapi`) so they stay out of the public spec,
 * and they sit behind the CRON_SECRET guard rather than the user auth guard.
 * Cron delivery is best-effort (may be missed/duplicated/overlapping) so every
 * handler is reconciliation-style / idempotent.
 *
 * Mounted at /api/cron (see server/app.ts). See: docs/migration/10-background-and-cron.md
 */

export const cron = createRouter()

cron.use('*', async (c, next) => {
  const auth = c.req.header('Authorization')
  const secret = getSettings().CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return c.text('Unauthorized', 401)
  }
  await next()
})

// GET /reconcile-payments — safety-net sweep over pending payments (webhooks are primary).
cron.get('/reconcile-payments', async (c) => {
  const result = await paymentService.reconcilePendingPayments({
    limit: getSettings().PAYMENT_RECONCILE_POLL_LIMIT,
  })
  return c.json({ success: true, ...result })
})

// GET /account-lifecycle — process due deactivation/deletion jobs.
// TODO: wire to the account-lifecycle service once ported (process due jobs).
// Stubbed idempotently for now so the cron declaration is valid and harmless.
cron.get('/account-lifecycle', async (c) => {
  return c.json({ success: true, processed: 0 })
})

// GET /expire-cleanup — belt-and-suspenders for anything not covered by TTL indexes
// (sessions + oauth_states are already TTL-cleaned in Mongo). Idempotent no-op.
cron.get('/expire-cleanup', async (c) => {
  return c.json({ success: true })
})
