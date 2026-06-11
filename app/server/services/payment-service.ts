import { notFound, forbidden, conflict, badRequest } from '@/server/core/errors'
import * as paymentRepo from '@/server/repositories/payment-repo'
import * as paymentMethodRepo from '@/server/repositories/payment-method-repo'
import { getPaymentProvider, getProviderByName } from '@/server/core/payments/manager'
import type { WebhookEvent } from '@/server/core/payments/types'
import type {
  PaymentMethodCreate,
  PaymentMethodOut,
  PaymentMethodUpdate,
  PaymentOut,
  PaymentStatus,
} from '@/server/schemas/payment'

/**
 * Payment business logic. No HTTP/Hono types here so the reconcile cron and
 * tests can reuse it (see docs/migration/10-background-and-cron.md).
 *
 * See: docs/migration/09-payments.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Statuses that are settled and should never be moved by reconcile/webhook noise. */
const TERMINAL: ReadonlySet<PaymentStatus> = new Set(['succeeded', 'failed', 'refunded', 'cancelled'])

// --- payments ---

export async function getById(id: string): Promise<PaymentOut> {
  const row = await paymentRepo.getById(id)
  if (!row) throw notFound('Payment not found')
  return paymentRepo.toPaymentOut(row)
}

export async function getByReference(reference: string): Promise<PaymentOut> {
  const row = await paymentRepo.getByReference(reference)
  if (!row) throw notFound('Payment not found')
  return paymentRepo.toPaymentOut(row)
}

/** Ownership guard for customer-scoped reads/actions. */
async function loadOwned(paymentId: string, customerId: string) {
  const row = await paymentRepo.getById(paymentId)
  if (!row) throw notFound('Payment not found')
  if (row.customerId !== customerId) throw forbidden('Payment does not belong to caller')
  return row
}

export async function getByIdForCustomer(paymentId: string, customerId: string): Promise<PaymentOut> {
  const row = await loadOwned(paymentId, customerId)
  return paymentRepo.toPaymentOut(row)
}

export async function getByReferenceForCustomer(reference: string, customerId: string): Promise<PaymentOut> {
  const row = await paymentRepo.getByReference(reference)
  if (!row) throw notFound('Payment not found')
  if (row.customerId !== customerId) throw forbidden('Payment does not belong to caller')
  return paymentRepo.toPaymentOut(row)
}

/**
 * Apply a verified webhook event. Idempotent: duplicate provider event ids are
 * short-circuited, and status is set (never incremented). Terminal payments are
 * not regressed.
 */
export async function applyWebhookEvent(event: WebhookEvent): Promise<{ applied: boolean; reason?: string }> {
  // Idempotency on redelivery — unique sparse index on providerEventId backs this.
  if (event.eventId) {
    const seen = await paymentRepo.getByProviderEventId(event.eventId)
    if (seen) return { applied: false, reason: 'duplicate_event' }
  }

  if (!event.reference) return { applied: false, reason: 'no_reference' }
  if (!event.status) return { applied: false, reason: 'no_status' }

  const payment = await paymentRepo.getByReference(event.reference)
  if (!payment) return { applied: false, reason: 'unknown_payment' }

  // Don't regress a settled payment (e.g. a late `processing` after `succeeded`).
  if (TERMINAL.has(payment.status) && payment.status !== event.status) {
    return { applied: false, reason: 'already_terminal' }
  }

  await paymentRepo.updateStatus(String(payment._id), event.status, {
    providerReference: event.providerReference ?? payment.providerReference ?? null,
    providerEventId: event.eventId || null,
  })
  return { applied: true }
}

/**
 * Reconcile pending payments — the cron + manual safety net. Sweeps pending /
 * processing payments (oldest first) and asks the provider for the current
 * state, applying set-status semantics. Idempotent.
 *
 * Used by the daily Vercel Cron and the manual reconcile endpoint.
 */
export async function reconcilePendingPayments(args: { limit: number }): Promise<{ reconciled: number }> {
  const pending = await paymentRepo.findPending(args.limit)
  let reconciled = 0
  for (const row of pending) {
    try {
      const provider = getProviderByName(row.provider)
      const lookupRef = row.providerReference ?? row.reference
      const tx = await provider.fetchTransaction({ reference: lookupRef })
      if (tx.status && tx.status !== row.status && !TERMINAL.has(row.status)) {
        await paymentRepo.updateStatus(String(row._id), tx.status, {
          providerReference: tx.providerReference ?? row.providerReference ?? null,
        })
        reconciled += 1
      }
    } catch {
      // Skip stragglers that error (provider down, unknown ref) — next sweep retries.
      continue
    }
  }
  return { reconciled }
}

/** Reconcile a single payment by id (manual ops trigger), enforcing ownership. */
export async function reconcileOne(paymentId: string, customerId: string): Promise<PaymentOut> {
  const row = await loadOwned(paymentId, customerId)
  if (TERMINAL.has(row.status)) return paymentRepo.toPaymentOut(row)

  const provider = getProviderByName(row.provider)
  const lookupRef = row.providerReference ?? row.reference
  const tx = await provider.fetchTransaction({ reference: lookupRef })
  if (tx.status && tx.status !== row.status) {
    const updated = await paymentRepo.updateStatus(String(row._id), tx.status, {
      providerReference: tx.providerReference ?? row.providerReference ?? null,
    })
    return paymentRepo.toPaymentOut(updated)
  }
  return paymentRepo.toPaymentOut(row)
}

/** Refund a payment via the provider, then record the refunded status. */
export async function refund(
  paymentId: string,
  customerId: string,
  opts?: { amountMinor?: number },
): Promise<PaymentOut> {
  const row = await loadOwned(paymentId, customerId)
  if (row.status === 'refunded') return paymentRepo.toPaymentOut(row)
  if (row.status !== 'succeeded') throw conflict('Only succeeded payments can be refunded', { status: row.status })

  const provider = getProviderByName(row.provider)
  const lookupRef = row.providerReference ?? row.reference
  const tx = await provider.refund({ reference: lookupRef, amountMinor: opts?.amountMinor })
  const updated = await paymentRepo.updateStatus(String(row._id), tx.status ?? 'refunded', {
    providerReference: tx.providerReference ?? row.providerReference ?? null,
  })
  return paymentRepo.toPaymentOut(updated)
}

// --- payment methods ---

export async function listMethods(customerId: string): Promise<PaymentMethodOut[]> {
  return paymentMethodRepo.listByCustomer(customerId)
}

export async function createMethod(customerId: string, payload: PaymentMethodCreate): Promise<PaymentMethodOut> {
  const ts = nowEpoch()
  const created = await paymentMethodRepo.create({
    customerId,
    provider: payload.provider,
    type: payload.type,
    brand: payload.brand ?? null,
    last4: payload.last4 ?? null,
    expMonth: payload.expMonth ?? null,
    expYear: payload.expYear ?? null,
    providerToken: payload.providerToken ?? null,
    isDefault: payload.isDefault,
    dateCreated: ts,
    lastUpdated: ts,
  })
  if (payload.isDefault) {
    await paymentMethodRepo.setDefault(customerId, created.id)
    return paymentMethodRepo.toPaymentMethodOut(await paymentMethodRepo.getById(created.id))
  }
  return created
}

async function loadOwnedMethod(methodId: string, customerId: string) {
  const row = await paymentMethodRepo.getById(methodId)
  if (!row) throw notFound('Payment method not found')
  if (row.customerId !== customerId) throw forbidden('Payment method does not belong to caller')
  return row
}

export async function updateMethod(
  methodId: string,
  customerId: string,
  patch: PaymentMethodUpdate,
): Promise<PaymentMethodOut> {
  await loadOwnedMethod(methodId, customerId)
  const { isDefault, ...rest } = patch
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) cleaned[k] = v
  if (Object.keys(cleaned).length === 0 && isDefault === undefined) {
    throw badRequest('No fields to update')
  }
  if (Object.keys(cleaned).length > 0) {
    await paymentMethodRepo.update(methodId, cleaned)
  }
  if (isDefault === true) {
    await paymentMethodRepo.setDefault(customerId, methodId)
  }
  return paymentMethodRepo.toPaymentMethodOut(await paymentMethodRepo.getById(methodId))
}

export async function deleteMethod(methodId: string, customerId: string): Promise<void> {
  await loadOwnedMethod(methodId, customerId)
  await paymentMethodRepo.remove(methodId)
}

export async function setDefaultMethod(methodId: string, customerId: string): Promise<PaymentMethodOut> {
  await loadOwnedMethod(methodId, customerId)
  const updated = await paymentMethodRepo.setDefault(customerId, methodId)
  return paymentMethodRepo.toPaymentMethodOut(updated)
}

/** Re-export the configured default provider (handy for callers/tests). */
export { getPaymentProvider }
