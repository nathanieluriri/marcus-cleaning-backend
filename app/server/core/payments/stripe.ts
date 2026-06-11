import Stripe from 'stripe'
import { getSettings } from '@/server/core/settings'
import { badRequest } from '@/server/core/errors'
import type { PaymentProvider } from './provider'
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentStatus,
  PaymentTransaction,
  WebhookEvent,
} from './types'

/**
 * Stripe provider — uses the official `stripe` Node SDK.
 * Ported from `core/payments/stripe_provider.py`.
 *
 * Webhook verification uses `stripe.webhooks.constructEvent` on the RAW body
 * with `STRIPE_WEBHOOK_SECRET`. See: ../../../../docs/migration/09-payments.md
 */

/** Map a Stripe PaymentIntent status to our normalized status. */
function mapIntentStatus(status: string | null | undefined): PaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'processing':
      return 'processing'
    case 'canceled':
      return 'cancelled'
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return 'pending'
    default:
      return 'pending'
  }
}

/** Stripe verifies against the exact raw payload (string or Buffer). */
function rawPayload(body: Uint8Array | string): string | Buffer {
  return typeof body === 'string' ? body : Buffer.from(body)
}

export class StripeProvider implements PaymentProvider {
  readonly providerName = 'stripe'
  private readonly client: Stripe
  private readonly webhookSecret: string

  constructor() {
    const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = getSettings()
    if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
    if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
    // Uses the SDK's pinned API version (doc 09: "pin the API version" — the
    // pin travels with the installed `stripe` package).
    this.client = new Stripe(STRIPE_SECRET_KEY)
    this.webhookSecret = STRIPE_WEBHOOK_SECRET
  }

  async createIntent(payload: PaymentIntentRequest): Promise<PaymentIntentResponse> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: payload.amountMinor,
        currency: payload.currency.toLowerCase(),
        description: payload.description,
        receipt_email: payload.customerEmail,
        metadata: {
          reference: payload.reference,
          customerId: payload.customerId,
          ...(payload.metadata ?? {}),
        },
      },
      // Idempotency on retries (doc 09 "Stripe-specific notes").
      { idempotencyKey: `intent:${payload.reference}` },
    )
    return {
      reference: payload.reference,
      providerReference: intent.id,
      status: mapIntentStatus(intent.status),
      checkoutUrl: null,
      clientSecret: intent.client_secret ?? null,
      raw: intent,
    }
  }

  async verifyWebhook(args: {
    body: Uint8Array | string
    headers: Record<string, string>
  }): Promise<WebhookEvent> {
    const signature = args.headers['stripe-signature'] ?? args.headers['Stripe-Signature']
    if (!signature) throw badRequest('Missing Stripe-Signature header')

    let event: Stripe.Event
    try {
      event = this.client.webhooks.constructEvent(rawPayload(args.body), signature, this.webhookSecret)
    } catch (err) {
      throw badRequest('Invalid Stripe webhook signature', { reason: String(err) })
    }

    const obj = event.data.object as unknown as Record<string, unknown>
    const metadata = (obj.metadata as Record<string, string> | undefined) ?? {}
    const status = event.type.startsWith('payment_intent.')
      ? mapIntentStatus(obj.status as string | undefined)
      : this.statusFromEventType(event.type)

    return {
      provider: this.providerName,
      eventId: event.id,
      type: event.type,
      reference: metadata.reference ?? null,
      providerReference: (obj.id as string | undefined) ?? null,
      status,
      amountMinor: typeof obj.amount === 'number' ? obj.amount : null,
      currency: typeof obj.currency === 'string' ? obj.currency : null,
      raw: event,
    }
  }

  private statusFromEventType(type: string): PaymentStatus | null {
    if (type.includes('succeeded')) return 'succeeded'
    if (type.includes('failed')) return 'failed'
    if (type.includes('refunded')) return 'refunded'
    if (type.includes('canceled') || type.includes('cancelled')) return 'cancelled'
    return null
  }

  async fetchTransaction(args: { reference: string }): Promise<PaymentTransaction> {
    // `reference` here is the Stripe PaymentIntent id stored as providerReference.
    const intent = await this.client.paymentIntents.retrieve(args.reference)
    return {
      reference: (intent.metadata?.reference as string | undefined) ?? args.reference,
      providerReference: intent.id,
      status: mapIntentStatus(intent.status),
      amountMinor: intent.amount,
      currency: intent.currency,
      raw: intent,
    }
  }

  async refund(args: { reference: string; amountMinor?: number }): Promise<PaymentTransaction> {
    const refund = await this.client.refunds.create({
      payment_intent: args.reference,
      ...(args.amountMinor != null ? { amount: args.amountMinor } : {}),
    })
    return {
      reference: args.reference,
      providerReference: refund.id,
      status: 'refunded',
      amountMinor: refund.amount ?? null,
      currency: refund.currency ?? null,
      raw: refund,
    }
  }
}
