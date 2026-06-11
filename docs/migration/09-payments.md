# 09 — Payments (Provider Abstraction + Webhooks)

The current payments design is already well-structured for serverless and ports almost directly. The big change is that **provider webhooks become the source of truth** (replacing the polled reconciliation job).

## Provider abstraction (ported 1:1)

The current `PaymentProvider` Protocol (`core/payments/provider.py`) maps to a TypeScript interface:

```ts
// src/server/core/payments/provider.ts
export interface PaymentProvider {
  providerName: string
  createIntent(payload: PaymentIntentRequest): Promise<PaymentIntentResponse>
  verifyWebhook(args: { body: Uint8Array | string; headers: Record<string, string> }): Promise<WebhookEvent>
  fetchTransaction(args: { reference: string }): Promise<PaymentTransaction>
  refund(args: { reference: string; amountMinor?: number }): Promise<PaymentTransaction>
}
```

Implementations (port from `core/payments/`):

| Current | Target | Notes |
|---|---|---|
| `stripe_provider.py` | `core/payments/stripe.ts` | Official `stripe` Node SDK; `stripe.webhooks.constructEvent` for signature verify |
| `flutterwave_provider.py` | `core/payments/flutterwave.ts` | HTTP via `fetch`; verify webhook via `verif-hash` header == `FLW_WEBHOOK_SECRET_HASH` |
| `test_environment_provider.py` | `core/payments/test.ts` | Local/test provider; checkout link resolves to `/web/payments/link/{reference}` |
| `manager.py` | `core/payments/manager.ts` | Selects provider from `PAYMENT_DEFAULT_PROVIDER`; `configureFromSettings()` |
| `types.py` | `core/payments/types.ts` | `PaymentIntentRequest/Response`, `PaymentTransaction`, `WebhookEvent` (Zod) |

The manager is a module-level singleton configured from env (no FastAPI lifespan needed):

```ts
// src/server/core/payments/manager.ts
let provider: PaymentProvider
export function getPaymentProvider(): PaymentProvider {
  if (!provider) provider = buildProviderFromSettings(settings.PAYMENT_DEFAULT_PROVIDER)
  return provider
}
```

## Webhook handler (`POST /v1/payments/webhooks/{provider}`)

This is the critical serverless reliability path. Requirements:

1. **Read the raw body** for signature verification. In Hono: `await c.req.arrayBuffer()` (do not parse JSON before verifying). Stripe and Flutterwave both verify against the raw bytes.
2. **Verify the signature** via the provider (`verifyWebhook`). Reject `400` on failure.
3. **Idempotency** — webhooks can be redelivered. Record processed event ids (e.g. a `webhook_events` collection or unique index on `payments.providerEventId`) and short-circuit duplicates. The existing unique sparse index on `bookings.payment_id` already guards double-linking.
4. **Update payment + booking state** via `payment-service` (reuses the same logic the reconcile cron calls).
5. Return `200` quickly. For any slow follow-up (e.g. sending a receipt email), use `waitUntil` so the webhook responds fast while the side effect completes (still bounded by `maxDuration`).

```ts
// inside payments router
payments.post('/webhooks/:provider', async (c) => {
  const provider = getPaymentProviderByName(c.req.param('provider'))
  const body = new Uint8Array(await c.req.arrayBuffer())
  const event = await provider.verifyWebhook({ body, headers: headerMap(c) }) // throws → 400 via onError
  await paymentService.applyWebhookEvent(event)   // idempotent
  return c.text('OK', 200)
})
```

> The webhook route is **public** (no bearer) but authenticated by signature. Do not put it behind the auth guard.

## Reconciliation (replaces the polled job)

Today `reconcile_pending_payments` is enqueued every N seconds by APScheduler. Target:

- **Primary:** webhooks update status in near-real-time.
- **Safety net:** a **daily Vercel Cron** (`/api/cron/reconcile-payments`) sweeps `payments` in a pending state older than a threshold and calls `provider.fetchTransaction` to settle stragglers. Idempotent (set-status semantics, not increment). See `10`.
- **Manual:** the existing `POST /v1/payments/{payment_id}/reconcile` endpoint stays for ops/admin-triggered reconcile, calling the same service function.

This three-way design (webhook + cron + manual) is strictly more reliable than the current poll-only loop and needs no worker.

## Refunds

`POST /v1/payments/{payment_id}/refund` → `paymentService.refund` → `provider.refund`. Unchanged contract.

## Web payment pages

`/web/payments/template` and `/web/payments/link/{reference}` render HTML for the test/checkout preview. Options:
- Port the Jinja template to a Next.js route handler / page returning HTML, with `payment-template.css/js` served from `public/`.
- Keep them ⚙️ hidden from OpenAPI (as today).

## Stripe-specific notes

- Use the official `stripe` Node SDK; pin the API version.
- `stripe.webhooks.constructEvent(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)` for verification.
- Consider Stripe's idempotency keys on create-intent calls for safety on retries.

## Env (see `11`)

`PAYMENT_DEFAULT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FLUTTERWAVE_SECRET_KEY`, `FLW_WEBHOOK_SECRET_HASH`, `TEST_PAYMENT_BASE_URL`, `TEST_PAYMENT_WEBHOOK_SECRET_HASH`, `SUCCESS_PAGE_URL`, `ERROR_PAGE_URL`.

## Cross-references

- Reconcile cron: `10-background-and-cron.md`
- Payment endpoints: `07-domain-endpoints.md`
- Booking↔payment linkage + state machine: `06`
