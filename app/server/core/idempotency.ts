import { createHash } from 'node:crypto'
import { conflict } from './errors'
import * as idempotencyRepo from '@/server/repositories/idempotency-repo'

/**
 * `Idempotency-Key` support for unsafe POSTs (booking creation, job completion,
 * cash-out). Clients that retry a request — a double tap, a network retry —
 * must not produce a second side effect.
 *
 * Semantics:
 *   - No header  -> the operation runs normally (opt-in, non-breaking).
 *   - First call  -> claim the key, run the operation, store the response.
 *   - Replay with the SAME body -> the stored response is returned verbatim.
 *   - Replay with a DIFFERENT body -> 409 IDEMPOTENCY_KEY_REUSED.
 *   - Replay while the first call is still running -> 409 IDEMPOTENCY_IN_PROGRESS.
 *
 * Keys are scoped per operation AND per actor, so one user's key can never
 * collide with another's. Records expire after 24h.
 */

const TTL_SECONDS = 60 * 60 * 24

export interface IdempotentResult<T> {
  data: T
  httpStatus: number
  /** True when the response was replayed from a previous identical request. */
  replayed: boolean
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex')
}

/**
 * Run `operation` at most once per (scope, key, actor).
 *
 * `key` is the raw `Idempotency-Key` header; pass `undefined`/null to bypass.
 */
export async function withIdempotency<T>(args: {
  scope: string
  key: string | undefined | null
  actorId: string
  body: unknown
  httpStatus?: number
  operation: () => Promise<T>
}): Promise<IdempotentResult<T>> {
  const httpStatus = args.httpStatus ?? 200
  const key = args.key?.trim()
  if (!key) {
    return { data: await args.operation(), httpStatus, replayed: false }
  }

  const requestHash = hashBody(args.body)
  const now = Math.floor(Date.now() / 1000)

  const claimed = await idempotencyRepo.claim({
    scope: args.scope,
    key,
    actorId: args.actorId,
    requestHash,
    status: 'IN_PROGRESS',
    response: null,
    httpStatus: null,
    dateCreated: now,
    expiresAt: new Date((now + TTL_SECONDS) * 1000),
  })

  if (!claimed) {
    const existing = await idempotencyRepo.findRecord(args.scope, key, args.actorId)
    // Vanished between the failed claim and this read (TTL/release) — retry once.
    if (!existing) {
      return { data: await args.operation(), httpStatus, replayed: false }
    }
    if (existing.requestHash !== requestHash) {
      throw conflict('This Idempotency-Key was already used with a different request body', {
        code: 'IDEMPOTENCY_KEY_REUSED',
      })
    }
    if (existing.status === 'IN_PROGRESS') {
      throw conflict('A request with this Idempotency-Key is still in progress', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
      })
    }
    return {
      data: existing.response as T,
      httpStatus: existing.httpStatus ?? httpStatus,
      replayed: true,
    }
  }

  try {
    const data = await args.operation()
    await idempotencyRepo.complete(args.scope, key, args.actorId, data, httpStatus)
    return { data, httpStatus, replayed: false }
  } catch (err) {
    // Failed operations must not poison the key — the client may legitimately retry.
    await idempotencyRepo.release(args.scope, key, args.actorId)
    throw err
  }
}
