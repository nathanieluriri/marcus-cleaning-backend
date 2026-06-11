import { z } from '@hono/zod-openapi'

/**
 * Payment domain schemas (Zod + OpenAPI).
 * Ported from `schemas/payment_schema.py` + `schemas/payment_method_schema.py`.
 *
 * See: docs/migration/07-domain-endpoints.md, docs/migration/09-payments.md
 */

export const PaymentStatus = z.enum([
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded',
  'cancelled',
])
export type PaymentStatus = z.infer<typeof PaymentStatus>

export const PaymentProviderName = z.enum(['stripe', 'flutterwave', 'test'])
export type PaymentProviderName = z.infer<typeof PaymentProviderName>

/** Public payment view. */
export const PaymentOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    reference: z.string().openapi({ example: 'pay_abc123' }),
    provider: PaymentProviderName,
    providerReference: z.string().nullable().default(null),
    providerEventId: z.string().nullable().default(null),
    status: PaymentStatus,
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().openapi({ example: 'USD' }),
    customerId: z.string(),
    bookingId: z.string().nullable().default(null),
    paymentMethodId: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('PaymentOut')
export type PaymentOut = z.infer<typeof PaymentOut>

/** Internal DB document shape for the `payments` collection. */
export interface PaymentDoc {
  reference: string
  provider: PaymentProviderName
  providerReference?: string | null
  providerEventId?: string | null
  status: PaymentStatus
  amountMinor: number
  currency: string
  customerId: string
  bookingId?: string | null
  paymentMethodId?: string | null
  dateCreated: number
  lastUpdated: number
}

/** Public payment-method view. */
export const PaymentMethodOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    customerId: z.string(),
    provider: PaymentProviderName,
    type: z.string().openapi({ example: 'card' }),
    brand: z.string().nullable().default(null).openapi({ example: 'visa' }),
    last4: z.string().nullable().default(null).openapi({ example: '4242' }),
    expMonth: z.number().int().nullable().default(null),
    expYear: z.number().int().nullable().default(null),
    providerToken: z.string().nullable().default(null),
    isDefault: z.boolean().default(false),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('PaymentMethodOut')
export type PaymentMethodOut = z.infer<typeof PaymentMethodOut>

/** Internal DB document shape for the `payment_methods` collection. */
export interface PaymentMethodDoc {
  customerId: string
  provider: PaymentProviderName
  type: string
  brand?: string | null
  last4?: string | null
  expMonth?: number | null
  expYear?: number | null
  providerToken?: string | null
  isDefault: boolean
  dateCreated: number
  lastUpdated: number
}

export const PaymentMethodCreate = z
  .object({
    provider: PaymentProviderName.default('test'),
    type: z.string().min(1).default('card').openapi({ example: 'card' }),
    brand: z.string().optional().openapi({ example: 'visa' }),
    last4: z.string().min(2).max(4).optional().openapi({ example: '4242' }),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().optional(),
    /** Tokenized reference from the provider (never raw PAN). */
    providerToken: z.string().optional(),
    isDefault: z.boolean().default(false),
  })
  .openapi('PaymentMethodCreate')
export type PaymentMethodCreate = z.infer<typeof PaymentMethodCreate>

export const PaymentMethodUpdate = z
  .object({
    brand: z.string().optional(),
    last4: z.string().min(2).max(4).optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi('PaymentMethodUpdate')
export type PaymentMethodUpdate = z.infer<typeof PaymentMethodUpdate>

export const RefundRequest = z
  .object({
    /** Partial refund amount in minor units; omit for full refund. */
    amountMinor: z.number().int().positive().optional(),
  })
  .openapi('RefundRequest')
export type RefundRequest = z.infer<typeof RefundRequest>

export const ReconcileResult = z
  .object({ reconciled: z.number().int().nonnegative() })
  .openapi('ReconcileResult')
export type ReconcileResult = z.infer<typeof ReconcileResult>

/** List wrapper for payment methods. */
export const PaymentMethodList = z.object({ items: z.array(PaymentMethodOut) }).openapi('PaymentMethodList')
export type PaymentMethodList = z.infer<typeof PaymentMethodList>
