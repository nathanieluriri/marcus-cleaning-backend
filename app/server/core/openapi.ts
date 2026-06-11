import type { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import type { Env } from './http-env'

/**
 * OpenAPI 3.1 document + Scalar reference UI.
 *  - Spec:      GET /api/doc
 *  - Reference: GET /api/reference
 *
 * Note: @hono/zod-openapi does not fold a Hono basePath into emitted paths, so
 * we declare `servers: [{ url: '/api' }]` and write route paths relative to the
 * router mount. See: ../../../docs/migration/05-api-docs-scalar.md
 */

export function mountDocs(app: OpenAPIHono<Env>): void {
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })

  app.doc31('/api/doc', {
    openapi: '3.1.0',
    info: {
      title: 'Marcus Cleaning API',
      version: '1.0.0',
      description: 'Serverless backend for the Marcus Cleaning platform.',
    },
    servers: [{ url: '/api', description: 'Current deployment' }],
  })

  app.get(
    '/api/reference',
    Scalar({
      url: '/api/doc',
      pageTitle: 'Marcus Cleaning API',
    }),
  )
}
