import { createMiddleware } from 'hono/factory'
import type { Env } from './http-env'

/**
 * Request timing middleware — sets X-Process-Time.
 * Ported from `RequestTimingMiddleware` in `main.py`.
 * Request-id is handled by Hono's built-in `requestId()` middleware (see app.ts).
 */

export const timing = () =>
  createMiddleware<Env>(async (c, next) => {
    const start = performance.now()
    await next()
    c.header('X-Process-Time', String((performance.now() - start) / 1000))
  })
