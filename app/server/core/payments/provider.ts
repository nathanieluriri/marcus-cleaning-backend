import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentTransaction,
  WebhookEvent,
} from './types'

/**
 * Provider abstraction (ported 1:1 from `core/payments/provider.py`).
 *
 * Implementations live alongside this file (`stripe.ts`, `flutterwave.ts`,
 * `test.ts`) and are selected by the manager from settings. Implementations
 * must NOT touch the database — they only talk to the payment provider.
 *
 * See: ../../../../docs/migration/09-payments.md
 */
export interface PaymentProvider {
  readonly providerName: string

  /** Open a payment intent / hosted checkout. */
  createIntent(payload: PaymentIntentRequest): Promise<PaymentIntentResponse>

  /**
   * Verify a webhook against the RAW request body and headers, returning a
   * normalized event. MUST throw if the signature is invalid (router maps the
   * throw to a 400).
   */
  verifyWebhook(args: {
    body: Uint8Array | string
    headers: Record<string, string>
  }): Promise<WebhookEvent>

  /** Fetch the current state of a transaction (used by reconcile). */
  fetchTransaction(args: { reference: string }): Promise<PaymentTransaction>

  /** Refund a (settled) transaction, optionally a partial amount in minor units. */
  refund(args: { reference: string; amountMinor?: number }): Promise<PaymentTransaction>
}
