# 10 — Background Work → Cron + Webhooks + TTL

Decision **D5**: there are **no background workers** on serverless. Every Celery task and APScheduler job is replaced by one of: a **Vercel Cron** handler, a **provider webhook**, a **Mongo TTL index**, or **inline/`waitUntil`** work.

## Inventory of current async/scheduled work

From `core/task.py`, `main.py` lifespan, and `services/*`:

| Current job | Type | Replacement | Mechanism |
|---|---|---|---|
| `delete_tokens` | Celery task (on logout/delete) | **Mongo TTL index** on `sessions.expiresAt` | `02`, `03` — no job at all |
| `reconcile_pending_payments` | APScheduler poll (every N s) → Celery | **Webhooks** (primary) + **daily cron** sweep (safety net) | `09` + cron below |
| `generate_audit_export` | Celery task (heavy) | **On-demand** in-request (raised `maxDuration`, streamed) or cron-backed | below |
| account-lifecycle processor (`process_due_account_lifecycle_jobs`) | APScheduler (every 60 s) | **Daily/hourly cron** | cron below |
| APScheduler heartbeat | APScheduler (every 15 s) | **Removed** (Vercel monitors functions) | — |
| `system_broadcast` dispatch (`enqueue`) | Celery task | **Inline + `waitUntil`** (small) or batch send; queue for large fan-out | `08`, `15` |

## Vercel Cron declarations

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/reconcile-payments",  "schedule": "0 * * * *" },
    { "path": "/api/cron/account-lifecycle",   "schedule": "0 2 * * *" },
    { "path": "/api/cron/expire-cleanup",      "schedule": "0 3 * * *" }
  ]
}
```

> **Plan caveat:** on the **Hobby** plan crons run **at most once per day** (and fire within the scheduled *hour*). The hourly `0 * * * *` above requires **Pro** (per-minute precision, once-per-minute minimum). If staying on Hobby, change reconcile to daily and lean harder on webhooks. Confirm plan in `11`/`15`.

## Cron handler pattern (secured + idempotent)

Vercel triggers a cron with an HTTP **GET** to the production deployment and sends `Authorization: Bearer ${CRON_SECRET}`. Verify it; make every handler idempotent (cron can miss, duplicate, or overlap).

```ts
// src/server/routes/cron.ts
import { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from '../app'
import { settings } from '../core/settings'
import * as paymentService from '../services/payment-service'
import * as lifecycle from '../services/customer-app-contract-service'

export const cron = new OpenAPIHono<Env>()

cron.use('*', async (c, next) => {
  const auth = c.req.header('authorization')
  if (!settings.CRON_SECRET || auth !== `Bearer ${settings.CRON_SECRET}`) {
    return c.text('Unauthorized', 401)
  }
  await next()
})

cron.get('/reconcile-payments', async (c) => {
  const result = await paymentService.reconcilePendingPayments({ limit: settings.PAYMENT_RECONCILE_POLL_LIMIT })
  return c.json({ success: true, ...result })
})

cron.get('/account-lifecycle', async (c) => {
  const result = await lifecycle.processDueAccountLifecycleJobs({ limit: 100 })
  return c.json({ success: true, ...result })
})

cron.get('/expire-cleanup', async (c) => {
  // Belt-and-suspenders for anything not covered by TTL indexes (e.g. orphaned uploads).
  return c.json({ success: true })
})
```

These routes are **not** in OpenAPI/Scalar (register as plain `cron.get`, not `cron.openapi`) and **not** behind the user auth guard — they use the `CRON_SECRET` guard instead.

### Idempotency & overlap

- Cron delivery is best-effort: runs can be **missed, duplicated, or overlap**. Handlers must be reconciliation-style ("set status = settled if provider says paid"), never "increment".
- For jobs that must not overlap, take a short **distributed lock** in Upstash Redis (`SET key NX PX <ttl>`) at the top of the handler; bail if not acquired. Reconcile/lifecycle are naturally idempotent, so a lock is optional but recommended for the reconcile sweep.

## Audit export (the one heavy job)

Current flow: `POST /monitoring/audit/export` enqueues `generate_audit_export`; client polls `/export/{id}`; downloads via `/export/{id}/download`. Targets, in order of preference:

1. **On-demand synchronous + streamed (recommended default):** generate the export within the request and stream it to S3/Blob (or directly to the client) on a route with a raised `maxDuration` (its **own** route segment so only it gets the long duration — see `01`). Keep the create→status→download endpoints for client parity; "status" returns `ready` immediately for small/medium exports.
2. **Cron-backed:** `POST /export` writes an `export` job doc (`status: pending`); a frequent cron drains pending exports, writes the file, sets `status: ready`. Preserves the exact async UX without a worker. Use this if exports routinely exceed the function time budget.
3. **Queue (future):** Upstash QStash / Inngest for very large exports with retries — documented in `15`, not built now.

Store generated files in S3/Vercel Blob (the current code writes to `uploads/audit-exports/`); `/download` returns a signed URL or streams the object.

## `waitUntil` for post-response side effects

For fire-and-forget after responding (e.g. send a receipt email after a webhook, log an analytics event), use `waitUntil` from `@vercel/functions`:

```ts
import { waitUntil } from '@vercel/functions'
waitUntil(sendReceiptEmail(payment))   // response returns now; promise runs to completion (within maxDuration)
```

Note: `waitUntil` work still counts against `maxDuration` — it decouples from the response, it does not extend the time budget.

## Observability (replacing the heartbeat)

The APScheduler heartbeat health-check is gone. To keep equivalent visibility, have each cron handler write a `cron_runs` marker (`{ job, lastRunAt, ok }`) to Mongo/Upstash, and surface staleness in `/health` if desired. Vercel's dashboard also shows cron execution logs.

## Cross-references

- Payments reconcile + webhooks: `09-payments.md`
- TTL indexes: `02-data-model.md`
- Email batch/fan-out: `08-email-resend.md`
- Plan limits + env: `11-infra-and-env.md`
- Queue as future option: `15-open-questions-risks.md`
