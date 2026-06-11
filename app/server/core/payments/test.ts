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
 * Test / local provider — no external calls.
 * Ported from `core/payments/test_environment_provider.py`.
 *
 * The checkout link resolves to `${TEST_PAYMENT_BASE_URL}/web/payments/link/{reference}`
 * (the local web payment preview page). Webhooks are verified by comparing the
 * `verif-hash` header to `TEST_PAYMENT_WEBHOOK_SECRET_HASH` (when configured).
 *
 * See: ../../../../docs/migration/09-payments.md
 */
export class TestProvider implements PaymentProvider {
  readonly providerName = 'test'

  private checkoutUrl(reference: string): string {
    const base = (getSettings().TEST_PAYMENT_BASE_URL ?? '').replace(/\/+$/, '')
    return `${base}/web/payments/link/${encodeURIComponent(reference)}`
  }

  async createIntent(payload: PaymentIntentRequest): Promise<PaymentIntentResponse> {
    return {
      reference: payload.reference,
      providerReference: payload.reference,
      status: 'pending',
      checkoutUrl: this.checkoutUrl(payload.reference),
      clientSecret: null,
      raw: { provider: 'test', ...payload },
    }
  }

  async verifyWebhook(args: {
    body: Uint8Array | string
    headers: Record<string, string>
  }): Promise<WebhookEvent> {
    const expected = getSettings().TEST_PAYMENT_WEBHOOK_SECRET_HASH
    if (expected) {
      const presented = args.headers['verif-hash'] ?? args.headers['Verif-Hash']
      if (presented !== expected) throw badRequest('Invalid test webhook signature')
    }

    const text = typeof args.body === 'string' ? args.body : Buffer.from(args.body).toString('utf8')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw badRequest('Invalid test webhook body')
    }

    const reference = (parsed.reference as string | undefined) ?? null
    const status = ((parsed.status as string | undefined) ?? 'succeeded') as PaymentStatus
    return {
      provider: this.providerName,
      eventId: (parsed.eventId as string | undefined) ?? `test:${reference ?? ''}:${status}`,
      type: (parsed.type as string | undefined) ?? `payment.${status}`,
      reference,
      providerReference: reference,
      status,
      amountMinor: typeof parsed.amountMinor === 'number' ? parsed.amountMinor : null,
      currency: (parsed.currency as string | undefined) ?? null,
      raw: parsed,
    }
  }

  async fetchTransaction(args: { reference: string }): Promise<PaymentTransaction> {
    // The test provider cannot observe external settlement; report pending and
    // let webhooks / manual settlement drive status changes.
    return {
      reference: args.reference,
      providerReference: args.reference,
      status: 'pending',
      amountMinor: null,
      currency: null,
      raw: { provider: 'test' },
    }
  }

  async refund(args: { reference: string; amountMinor?: number }): Promise<PaymentTransaction> {
    return {
      reference: args.reference,
      providerReference: args.reference,
      status: 'refunded',
      amountMinor: args.amountMinor ?? null,
      currency: null,
      raw: { provider: 'test', refunded: true },
    }
  }
}
