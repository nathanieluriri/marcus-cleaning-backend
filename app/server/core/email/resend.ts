import { Resend } from 'resend'
import { getSettings } from '@/server/core/settings'

/**
 * Lazy, guarded Resend client.
 *
 * The client is built on first use (not at import) and cached at module scope,
 * so importing this file never throws when RESEND_API_KEY is absent (type-check,
 * build, tests). The send helpers call `getResend()`; a missing key fails there
 * with a clear error instead of crashing the module graph.
 *
 * Always server-side (Node runtime). See: docs/migration/08-email-resend.md
 */

let cached: Resend | null = null

export function getResend(): Resend {
  if (cached) return cached
  const { RESEND_API_KEY } = getSettings()
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured; cannot send email')
  }
  cached = new Resend(RESEND_API_KEY)
  return cached
}
