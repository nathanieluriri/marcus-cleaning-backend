import { handle } from 'hono/vercel'
import { app } from '@/server/app'

/**
 * Single Next.js catch-all route that hosts the entire Hono API.
 * Node.js runtime is REQUIRED (the MongoDB driver does not run on Edge).
 * See: docs/migration/01-architecture.md
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
export const OPTIONS = handle(app)
export const HEAD = handle(app)
