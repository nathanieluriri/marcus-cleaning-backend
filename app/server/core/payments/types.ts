import { z } from 'zod'

/**
 * Provider-agnostic payment types (Zod + inferred TS).
 * Ported from `core/payments/types.py`. These types describe the contract
 * between the payment-service and any `PaymentProvider` implementation; they
 * are deliberately free of Hono/HTTP concerns.
 *
 * Money is always represented in the smallest currency unit (minor units, e.g.
 * cents/kobo) as an integer, matching the provider SDKs.
 *
 * See: ../../../../docs/migration/09-payments.md
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

/** Request to open a payment intent / checkout with a provider. */
export const PaymentIntentRequest = z.object({
  /** Internal reference we generate and store on the payment row (idempotency key). */
  reference: z.string().min(1),
  /** Amount in minor units (e.g. cents). */
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
  customerId: z.string().min(1),
  customerEmail: z.string().email().optional(),
  description: z.string().optional(),
  /** Where the provider should redirect the user after success/failure. */
  redirectUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})
export type PaymentIntentRequest = z.infer<typeof PaymentIntentRequest>

/** What the provider returns after opening an intent. */
export const PaymentIntentResponse = z.object({
  /** Echo of our reference. */
  reference: z.string(),
  /** Provider-side id (PaymentIntent id, FLW tx ref, etc.). */
  providerReference: z.string().nullable().default(null),
  status: PaymentStatus,
  /** Hosted checkout / redirect URL the client should send the user to. */
  checkoutUrl: z.string().nullable().default(null),
  /** Provider client secret, where applicable (Stripe Payment Element). */
  clientSecret: z.string().nullable().default(null),
  raw: z.unknown().optional(),
})
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponse>

/** Normalized view of a transaction fetched from / settled by a provider. */
export const PaymentTransaction = z.object({
  reference: z.string(),
  providerReference: z.string().nullable().default(null),
  status: PaymentStatus,
  amountMinor: z.number().int().nonnegative().nullable().default(null),
  currency: z.string().nullable().default(null),
  raw: z.unknown().optional(),
})
export type PaymentTransaction = z.infer<typeof PaymentTransaction>

/** Normalized webhook event after the provider verifies the signature. */
export const WebhookEvent = z.object({
  provider: z.string(),
  /** Provider event id — used for idempotency (`payments.providerEventId`). */
  eventId: z.string(),
  /** Provider event type, e.g. `payment_intent.succeeded`. */
  type: z.string(),
  /** Our reference, extracted from the event payload (may be null on noise events). */
  reference: z.string().nullable().default(null),
  providerReference: z.string().nullable().default(null),
  status: PaymentStatus.nullable().default(null),
  amountMinor: z.number().int().nullable().default(null),
  currency: z.string().nullable().default(null),
  raw: z.unknown().optional(),
})
export type WebhookEvent = z.infer<typeof WebhookEvent>
