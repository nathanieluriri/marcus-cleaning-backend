import { z } from '@hono/zod-openapi'
import type { AppContext } from './http-env'

/**
 * Standard response envelope: { success, message, data, requestId }.
 * Ported from `core/response_envelope.py`.
 *
 * See: ../../../docs/migration/04-api-layer.md
 */

export function ok<T>(c: AppContext, message: string, data: T) {
  return { success: true as const, message, data, requestId: c.get('requestId') ?? null }
}

export function fail(c: AppContext, message: string, code: string, details?: unknown) {
  return {
    success: false as const,
    message,
    data: { code, details: details ?? null },
    requestId: c.get('requestId') ?? null,
  }
}

/** Wrap a payload schema in the success envelope for OpenAPI responses. */
export function envelopeOf<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data,
    requestId: z.string().nullable(),
  })
}

/** Error envelope schema (for documenting 4xx/5xx responses). */
export const ErrorEnvelope = z
  .object({
    success: z.literal(false),
    message: z.string(),
    data: z.object({ code: z.string(), details: z.unknown().nullable() }),
    requestId: z.string().nullable(),
  })
  .openapi('ErrorEnvelope')
