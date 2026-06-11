import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { getDb } from '@/server/core/mongo'

/**
 * Health endpoints. `/health` pings MongoDB.
 * The APScheduler heartbeat check is removed (no scheduler). See docs/migration/07.
 */

export const health = createRouter()

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Health check',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
            services: z.record(z.string(), z.object({ status: z.string(), message: z.string() })),
          }),
        },
      },
    },
  },
})

health.openapi(healthRoute, async (c) => {
  const services: Record<string, { status: string; message: string }> = {}
  let status = 'healthy'
  try {
    await getDb().command({ ping: 1 })
    services.mongo = { status: 'healthy', message: 'MongoDB ping successful' }
  } catch (err) {
    status = 'degraded'
    services.mongo = { status: 'unhealthy', message: err instanceof Error ? err.message : 'ping failed' }
  }
  return c.json({ status, timestamp: new Date().toISOString(), services }, 200)
})
