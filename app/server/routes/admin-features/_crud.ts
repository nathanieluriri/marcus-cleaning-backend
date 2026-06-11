import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import type { Env } from '@/server/core/http-env'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { notFound } from '@/server/core/errors'
import {
  FeatureCreate,
  FeatureUpdate,
  FeatureOut,
  FeatureListOut,
  FeatureListQuery,
  IdParam,
} from '@/server/schemas/admin-features'
import * as repo from '@/server/repositories/admin-features/_generic-repo'

/**
 * Generic admin-feature CRUD router factory.
 *
 * Given a Mongo collection name, returns a `createRouter()` exposing the standard
 * admin-guarded CRUD surface:
 *   GET `/`, GET `/{id}`, POST `/`, PATCH `/{id}`, DELETE `/{id}`
 *
 * Every route is admin-guarded (`security:[{bearerAuth:[]}]` + `requireAdmin()`),
 * returns the standard `{ success, message, data, requestId }` envelope, and
 * delegates all Mongo access to the generic repo. Feature routers compose this
 * factory and then add their extra endpoints.
 *
 * See: docs/migration/07-domain-endpoints.md
 */

export interface CrudOptions {
  collection: string
  /** Human tag for OpenAPI grouping, e.g. 'ServiceDefinitions'. */
  tag: string
  /** Singular noun for messages, e.g. 'service definition'. */
  noun?: string
}

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

export function crudRouter(opts: CrudOptions): OpenAPIHono<Env> {
  const router = createRouter()
  const { collection, tag } = opts
  const noun = opts.noun ?? 'record'

  // All CRUD paths are admin-guarded.
  router.use('/', requireAdmin())
  router.use('/:id', requireAdmin())

  // GET /
  router.openapi(
    createRoute({
      method: 'get',
      path: '/',
      tags: [tag],
      security: [{ bearerAuth: [] }],
      request: { query: FeatureListQuery },
      responses: {
        200: { description: 'List', content: { 'application/json': { schema: envelopeOf(FeatureListOut) } } },
        ...errs,
      },
    }),
    async (c) => {
      principalOf(c)
      const { limit, skip } = c.req.valid('query')
      const result = await repo.listDocs(collection, { limit, skip })
      return c.json(ok(c, `${tag} listed`, FeatureListOut.parse(result)), 200)
    },
  )

  // POST /
  router.openapi(
    createRoute({
      method: 'post',
      path: '/',
      tags: [tag],
      security: [{ bearerAuth: [] }],
      request: { body: { content: { 'application/json': { schema: FeatureCreate } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
        ...errs,
      },
    }),
    async (c) => {
      principalOf(c)
      const body = c.req.valid('json') as Record<string, unknown>
      const created = await repo.insertDoc(collection, body)
      return c.json(ok(c, `Created ${noun}`, FeatureOut.parse(created)), 201)
    },
  )

  // GET /{id}
  router.openapi(
    createRoute({
      method: 'get',
      path: '/{id}',
      tags: [tag],
      security: [{ bearerAuth: [] }],
      request: { params: IdParam },
      responses: {
        200: { description: 'Fetched', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
        ...errs,
      },
    }),
    async (c) => {
      principalOf(c)
      const { id } = c.req.valid('param')
      const found = await repo.getDocById(collection, id)
      if (!found) throw notFound(`${noun} not found`)
      return c.json(ok(c, `Fetched ${noun}`, FeatureOut.parse(found)), 200)
    },
  )

  // PATCH /{id}
  router.openapi(
    createRoute({
      method: 'patch',
      path: '/{id}',
      tags: [tag],
      security: [{ bearerAuth: [] }],
      request: {
        params: IdParam,
        body: { content: { 'application/json': { schema: FeatureUpdate } } },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
        ...errs,
      },
    }),
    async (c) => {
      principalOf(c)
      const { id } = c.req.valid('param')
      const body = c.req.valid('json') as Record<string, unknown>
      const updated = await repo.updateDoc(collection, id, body)
      if (!updated) throw notFound(`${noun} not found`)
      return c.json(ok(c, `Updated ${noun}`, FeatureOut.parse(updated)), 200)
    },
  )

  // DELETE /{id}
  router.openapi(
    createRoute({
      method: 'delete',
      path: '/{id}',
      tags: [tag],
      security: [{ bearerAuth: [] }],
      request: { params: IdParam },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: envelopeOf(z.object({ id: z.string(), deleted: z.boolean() })) } } },
        ...errs,
      },
    }),
    async (c) => {
      principalOf(c)
      const { id } = c.req.valid('param')
      const deleted = await repo.deleteDoc(collection, id)
      if (!deleted) throw notFound(`${noun} not found`)
      return c.json(ok(c, `Deleted ${noun}`, { id, deleted }), 200)
    },
  )

  return router
}
