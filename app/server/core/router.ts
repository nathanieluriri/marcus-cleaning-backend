import { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from './http-env'
import { fail } from './envelope'
import { translate } from './i18n'
import { formatZodIssues } from './zod-format'

/**
 * Factory for an OpenAPIHono router pre-wired with the shared validation hook.
 *
 * `defaultHook` is per-instance and does NOT propagate to sub-apps mounted via
 * `.route()`, so every router (main app + each domain sub-router) must be built
 * here to get consistent, envelope-shaped 422 responses.
 */
export function createRouter(): OpenAPIHono<Env> {
  return new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          fail(
            c,
            translate('Validation error', c.get('locale') ?? 'en'),
            'VALIDATION_FAILED',
            formatZodIssues(result.error),
          ),
          422,
        )
      }
    },
  })
}
