import { describe, expect, it } from 'vitest'
import { z } from '@hono/zod-openapi'
import { crudRouter } from '@/server/routes/admin-features/_crud'

/**
 * The factory must stay backwards compatible: nine features still call it with no
 * schema and must keep their passthrough behaviour. Only the two new options change
 * anything.
 */
describe('crudRouter schema options', () => {
  it('builds a router when no schemas are supplied', () => {
    const router = crudRouter({ collection: 'x', tag: 'X', noun: 'x' })
    expect(router).toBeDefined()
  })

  it('builds a router when schemas are supplied', () => {
    const Create = z.object({ title: z.string() })
    const router = crudRouter({
      collection: 'x',
      tag: 'X',
      noun: 'x',
      createSchema: Create,
      updateSchema: Create.partial(),
    })
    expect(router).toBeDefined()
  })
})
