# 05 — API Documentation (OpenAPI 3.1 + Scalar)

Decision **D3**: the OpenAPI document is generated from the same Zod route definitions used for validation, and rendered by **Scalar**. This replaces Swagger UI / ReDoc.

## How the spec is produced

`@hono/zod-openapi`'s `OpenAPIHono` collects every route registered with `app.openapi(route, handler)` and produces an OpenAPI 3.1 document. `app.doc()` (or `app.doc31()`) registers a GET route that serves it.

```ts
// src/server/core/openapi.ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import type { Env } from '../app'

export function mountDocs(app: OpenAPIHono<Env>) {
  // Register the bearer security scheme used by createRoute({ security: [{ bearerAuth: [] }] }).
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })

  // Serve the OpenAPI 3.1 JSON.
  app.doc31('/doc', {
    openapi: '3.1.0',
    info: {
      title: 'Marcus Cleaning API',
      version: '1.0.0',
      description: 'Serverless backend for the Marcus Cleaning platform.',
    },
    // CRITICAL: the app is mounted under /api, but zod-openapi does not prefix basePath
    // into emitted paths. Declare the server prefix so clients/Scalar resolve URLs correctly.
    servers: [{ url: '/api', description: 'Current deployment' }],
  })

  // Scalar reference UI pointing at the served spec.
  app.get('/reference', Scalar({
    url: '/api/doc',
    pageTitle: 'Marcus Cleaning API',
    theme: 'default',
  }))
}
```

Resulting URLs:

| URL | Serves |
|-----|--------|
| `/api/doc` | OpenAPI 3.1 JSON |
| `/api/reference` | Scalar interactive reference UI |

> Old equivalents (`/docs` Swagger, `/redoc`) are retired. If any client or bookmark depends on `/docs`, add a redirect `/docs → /api/reference` (note in `07` deliberate changes).

## The basePath gotcha (and our resolution)

Known issue (honojs/middleware #952): when you build with `new OpenAPIHono().basePath('/api')`, runtime routing is correct (`/api/...`) but emitted spec paths omit the `/api` prefix. We deliberately **do not rely on Hono `basePath` for documented paths**. Instead:

1. Each router is mounted with its full prefix in `app.route('/api/v1/bookings', bookings)`.
2. `createRoute({ path })` is written **relative to the router** (e.g. `/`, `/{booking_id}`), so within the bookings router the spec lists `/bookings/{booking_id}`-style paths.
3. The `servers: [{ url: '/api' }]` entry supplies the remaining `/api` prefix so "try it" requests resolve to the real URL.

Verify against the pinned `@hono/zod-openapi` version at implementation time — if a release folds basePath into the spec, drop the `servers` workaround. (Tracked in `15`.)

## Documentation conventions (parity with current docs governance)

The current backend has rich per-endpoint documentation (`core/endpoint_docs.py`, `apply_feature_docs_to_routes`, `document_response`). We preserve that quality:

- **Every route** sets `tags`, a `summary`/`description`, a documented success response (wrapped via `envelopeOf(...)`), and at least the common error responses (401/403/422/429) referenced from shared schemas.
- **Examples** are attached on Zod fields via `.openapi({ example })` so Scalar shows realistic payloads.
- **Response envelope** is reflected in the schema (`envelopeOf`), so docs show the real shape, not the bare data.
- **Security**: protected routes declare `security: [{ bearerAuth: [] }]`; public ones omit it.
- **Hidden routes**: endpoints the current API hides from OpenAPI (`include_in_schema=False` — e.g. local upload helpers, web payment template pages) are simply not registered via `app.openapi(...)`; they are plain `app.get(...)` handlers and never appear in the spec.

## Generating a static spec (optional, for CI / client SDKs)

`app.getOpenAPIDocument(config)` returns the document object without serving it — useful to write `openapi.json` at build time for contract tests (see `13`) or client SDK generation:

```ts
import { writeFileSync } from 'node:fs'
import { app } from '@/server/app'
const doc = app.getOpenAPIDocument({ openapi: '3.1.0', info: { title: 'Marcus Cleaning API', version: '1.0.0' }, servers: [{ url: '/api' }] })
writeFileSync('openapi.json', JSON.stringify(doc, null, 2))
```

## Cross-references

- Route definition pattern: `04-api-layer.md`
- Contract parity / spec-based tests: `13-testing-strategy.md`
- basePath issue tracking: `15-open-questions-risks.md`
