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
 * Flutterwave provider — HTTP via `fetch` (no SDK).
 * Ported from `core/payments/flutterwave_provider.py`.
 *
 * Webhook verification compares the `verif-hash` header to
 * `FLW_WEBHOOK_SECRET_HASH`. See: ../../../../docs/migration/09-payments.md
 */

const FLW_BASE_URL = 'https://api.flutterwave.com/v3'

/** Map a Flutterwave status string to our normalized status. */
function mapStatus(status: string | null | undefined): PaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'successful':
    case 'completed':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'pending':
      return 'pending'
    default:
      return 'pending'
  }
}

export class FlutterwaveProvider implements PaymentProvider {
  readonly providerName = 'flutterwave'
  private readonly secretKey: string
  private readonly webhookSecretHash: string

  constructor() {
    const { FLUTTERWAVE_SECRET_KEY, FLW_WEBHOOK_SECRET_HASH } = getSettings()
    if (!FLUTTERWAVE_SECRET_KEY) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured')
    if (!FLW_WEBHOOK_SECRET_HASH) throw new Error('FLW_WEBHOOK_SECRET_HASH is not configured')
    this.secretKey = FLUTTERWAVE_SECRET_KEY
    this.webhookSecretHash = FLW_WEBHOOK_SECRET_HASH
  }

  private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(`${FLW_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      throw badRequest('Flutterwave request failed', { status: res.status, body: json })
    }
    return json
  }

  async createIntent(payload: PaymentIntentRequest): Promise<PaymentIntentResponse> {
    const body = {
      tx_ref: payload.reference,
      amount: payload.amountMinor / 100,
      currency: payload.currency,
      redirect_url: payload.redirectUrl,
      customer: {
        email: payload.customerEmail ?? `${payload.customerId}@placeholder.invalid`,
      },
      meta: { reference: payload.reference, customerId: payload.customerId, ...(payload.metadata ?? {}) },
      customizations: payload.description ? { title: payload.description } : undefined,
    }
    const json = await this.request('/payments', { method: 'POST', body: JSON.stringify(body) })
    const data = (json.data as Record<string, unknown> | undefined) ?? {}
    return {
      reference: payload.reference,
      providerReference: (data.id != null ? String(data.id) : null),
      status: 'pending',
      checkoutUrl: (data.link as string | undefined) ?? null,
      clientSecret: null,
      raw: json,
    }
  }

  async verifyWebhook(args: {
    body: Uint8Array | string
    headers: Record<string, string>
  }): Promise<WebhookEvent> {
    const presented = args.headers['verif-hash'] ?? args.headers['Verif-Hash']
    if (!presented || presented !== this.webhookSecretHash) {
      throw badRequest('Invalid Flutterwave webhook signature')
    }

    const text = typeof args.body === 'string' ? args.body : Buffer.from(args.body).toString('utf8')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw badRequest('Invalid Flutterwave webhook body')
    }

    const data = (parsed.data as Record<string, unknown> | undefined) ?? {}
    const status = mapStatus(data.status as string | undefined)
    const amount = typeof data.amount === 'number' ? Math.round(data.amount * 100) : null

    return {
      provider: this.providerName,
      eventId: data.id != null ? String(data.id) : String((parsed.event as string) ?? ''),
      type: (parsed.event as string | undefined) ?? 'charge.completed',
      reference: (data.tx_ref as string | undefined) ?? null,
      providerReference: data.id != null ? String(data.id) : null,
      status,
      amountMinor: amount,
      currency: (data.currency as string | undefined) ?? null,
      raw: parsed,
    }
  }

  async fetchTransaction(args: { reference: string }): Promise<PaymentTransaction> {
    // Look the transaction up by our tx_ref.
    const json = await this.request(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(args.reference)}`)
    const data = (json.data as Record<string, unknown> | undefined) ?? {}
    const amount = typeof data.amount === 'number' ? Math.round(data.amount * 100) : null
    return {
      reference: (data.tx_ref as string | undefined) ?? args.reference,
      providerReference: data.id != null ? String(data.id) : null,
      status: mapStatus(data.status as string | undefined),
      amountMinor: amount,
      currency: (data.currency as string | undefined) ?? null,
      raw: json,
    }
  }

  async refund(args: { reference: string; amountMinor?: number }): Promise<PaymentTransaction> {
    // Flutterwave refunds operate on the transaction id (providerReference).
    const body = args.amountMinor != null ? JSON.stringify({ amount: args.amountMinor / 100 }) : undefined
    const json = await this.request(`/transactions/${encodeURIComponent(args.reference)}/refund`, {
      method: 'POST',
      body,
    })
    return {
      reference: args.reference,
      providerReference: args.reference,
      status: 'refunded',
      amountMinor: args.amountMinor ?? null,
      currency: null,
      raw: json,
    }
  }
}
