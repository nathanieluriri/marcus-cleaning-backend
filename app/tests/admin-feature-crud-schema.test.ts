import { describe, expect, it } from 'vitest'
import { z } from '@hono/zod-openapi'
import type { SchemaObject, RequestBodyObject, ReferenceObject } from 'openapi3-ts/oas30'
import { crudRouter } from '@/server/routes/admin-features/_crud'

/** Narrow a possibly-$ref request body/schema to its concrete object shape. */
function isRef(obj: unknown): obj is ReferenceObject {
  return !!obj && typeof obj === 'object' && '$ref' in obj
}

function bodySchema(
  requestBody: RequestBodyObject | ReferenceObject | undefined,
): SchemaObject | ReferenceObject {
  if (!requestBody || isRef(requestBody)) {
    throw new Error('expected an inline RequestBodyObject with a JSON schema')
  }
  const schema = requestBody.content['application/json']?.schema
  if (!schema) throw new Error('expected an application/json schema')
  return schema
}

/**
 * The factory must stay backwards compatible: nine features still call it with no
 * schema and must keep their passthrough behaviour. Only the two new options change
 * anything.
 *
 * These tests introspect the generated OpenAPI document to prove the schemas are
 * wired to the correct routes (POST -> createSchema, PATCH -> updateSchema), not
 * just that the constructor doesn't throw. A swap between createBody/updateBody,
 * or a wrong default, would fail these assertions.
 */
const docConfig = { openapi: '3.0.0', info: { title: 'test', version: '1.0.0' } }

describe('crudRouter schema options', () => {
  it('uses distinct create/update schemas on the correct routes when supplied', () => {
    const CreateSchema = z.object({ createOnly: z.string() })
    const UpdateSchema = z.object({ updateOnly: z.string() }).partial()
    const router = crudRouter({
      collection: 'x',
      tag: 'X',
      noun: 'x',
      createSchema: CreateSchema,
      updateSchema: UpdateSchema,
    })

    const doc = router.getOpenAPIDocument(docConfig)

    const postBodySchema = bodySchema(doc.paths['/']?.post?.requestBody)
    const patchBodySchema = bodySchema(doc.paths['/{id}']?.patch?.requestBody)

    expect(isRef(postBodySchema)).toBe(false)
    expect(isRef(patchBodySchema)).toBe(false)
    const post = postBodySchema as SchemaObject
    const patch = patchBodySchema as SchemaObject

    // POST body must carry the create-only property, not the update-only one.
    expect(post.properties).toHaveProperty('createOnly')
    expect(post.properties).not.toHaveProperty('updateOnly')

    // PATCH body must carry the update-only property, not the create-only one.
    expect(patch.properties).toHaveProperty('updateOnly')
    expect(patch.properties).not.toHaveProperty('createOnly')

    // The two schemas must differ from each other, so a swap between POST/PATCH is caught.
    expect(post).not.toEqual(patch)
  })

  it('falls back to the shared passthrough default for both routes when no schemas are supplied', () => {
    const router = crudRouter({ collection: 'x', tag: 'X', noun: 'x' })

    const doc = router.getOpenAPIDocument(docConfig)

    const postBodySchema = bodySchema(doc.paths['/']?.post?.requestBody)
    const patchBodySchema = bodySchema(doc.paths['/{id}']?.patch?.requestBody)

    // Both routes must resolve to the shared default schemas (AdminFeatureCreate /
    // AdminFeatureUpdate) rather than any per-feature schema, and neither carries the
    // custom markers used in the "schemas supplied" test above.
    expect(isRef(postBodySchema)).toBe(true)
    expect(isRef(patchBodySchema)).toBe(true)
    expect((postBodySchema as ReferenceObject).$ref).toBe('#/components/schemas/AdminFeatureCreate')
    expect((patchBodySchema as ReferenceObject).$ref).toBe('#/components/schemas/AdminFeatureUpdate')

    const resolve = (ref: ReferenceObject): SchemaObject => {
      const name = ref.$ref.split('/').pop() as string
      const schemas = doc.components?.schemas as Record<string, SchemaObject> | undefined
      const resolved = schemas?.[name]
      if (!resolved) throw new Error(`schema ${name} not found in components`)
      return resolved
    }
    expect(resolve(postBodySchema as ReferenceObject).properties).not.toHaveProperty('createOnly')
    expect(resolve(patchBodySchema as ReferenceObject).properties).not.toHaveProperty('updateOnly')
  })
})
