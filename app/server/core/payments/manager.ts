import { getSettings } from '@/server/core/settings'
import { badRequest } from '@/server/core/errors'
import type { PaymentProvider } from './provider'
import { StripeProvider } from './stripe'
import { FlutterwaveProvider } from './flutterwave'
import { TestProvider } from './test'

/**
 * Provider manager (ported from `core/payments/manager.py`).
 *
 * Module-level singletons configured from env — no FastAPI lifespan needed.
 * The default provider comes from `settings.PAYMENT_DEFAULT_PROVIDER`; the
 * webhook route resolves the provider by name from the URL path.
 *
 * See: ../../../../docs/migration/09-payments.md
 */

export type ProviderName = 'stripe' | 'flutterwave' | 'test'

const cache = new Map<ProviderName, PaymentProvider>()

function build(name: ProviderName): PaymentProvider {
  switch (name) {
    case 'stripe':
      return new StripeProvider()
    case 'flutterwave':
      return new FlutterwaveProvider()
    case 'test':
      return new TestProvider()
    default:
      throw badRequest('Unknown payment provider', { provider: name })
  }
}

/** Resolve a provider by name (module-cached). Throws 400 for unknown names. */
export function getProviderByName(name: string): PaymentProvider {
  if (name !== 'stripe' && name !== 'flutterwave' && name !== 'test') {
    throw badRequest('Unknown payment provider', { provider: name })
  }
  const existing = cache.get(name)
  if (existing) return existing
  const built = build(name)
  cache.set(name, built)
  return built
}

/** The default provider selected from settings (module-cached singleton). */
export function getPaymentProvider(): PaymentProvider {
  return getProviderByName(getSettings().PAYMENT_DEFAULT_PROVIDER)
}

/** Test helper — clear the provider cache (used by Vitest). */
export function __resetProviderCache(): void {
  cache.clear()
}
