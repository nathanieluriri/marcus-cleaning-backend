import { describe, expect, it } from 'vitest'
import type { SchemaObject, RequestBodyObject, ReferenceObject } from 'openapi3-ts/oas30'
import { adminFeatures } from '@/server/routes/admin-features'

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

const docConfig = { openapi: '3.0.0', info: { title: 'test', version: '1.0.0' } }

/**
 * Mounted at /api/v1/admins in server/app.ts, so /feature-templates here resolves
 * to /api/v1/admins/feature-templates (the frontend client's expected path).
 *
 * These introspect the generated OpenAPI document to prove the templates router
 * is wired to FeatureTemplateCreate/FeatureTemplateUpdate on the correct routes,
 * not just that the router builds. A swap between the two schemas, or a fallback
 * to the generic passthrough default, would fail these assertions.
 */
describe('feature-templates router', () => {
  it('wires FeatureTemplateCreate to POST / and FeatureTemplateUpdate to PATCH /{id}, and the two differ', () => {
    const doc = adminFeatures.getOpenAPIDocument(docConfig)

    const postBodySchema = bodySchema(doc.paths['/feature-templates']?.post?.requestBody)
    const patchBodySchema = bodySchema(doc.paths['/feature-templates/{id}']?.patch?.requestBody)

    expect(isRef(postBodySchema)).toBe(true)
    expect(isRef(patchBodySchema)).toBe(true)
    expect((postBodySchema as ReferenceObject).$ref).toBe(
      '#/components/schemas/FeatureTemplateCreate',
    )
    expect((patchBodySchema as ReferenceObject).$ref).toBe(
      '#/components/schemas/FeatureTemplateUpdate',
    )

    const resolve = (ref: ReferenceObject): SchemaObject => {
      const name = ref.$ref.split('/').pop() as string
      const schemas = doc.components?.schemas as Record<string, SchemaObject> | undefined
      const resolved = schemas?.[name]
      if (!resolved) throw new Error(`schema ${name} not found in components`)
      return resolved
    }

    const post = resolve(postBodySchema as ReferenceObject)
    const patch = resolve(patchBodySchema as ReferenceObject)

    // Create requires `feature`/`name`/`payload`; update makes them all optional —
    // so the two schemas must differ, catching a POST/PATCH swap.
    expect(post).not.toEqual(patch)
    expect(post.required).toEqual(expect.arrayContaining(['feature', 'name', 'payload']))
    expect(patch.required ?? []).not.toEqual(expect.arrayContaining(['feature', 'name', 'payload']))
  })
})
