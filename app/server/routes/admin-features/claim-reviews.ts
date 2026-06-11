import { createRoute } from '@hono/zod-openapi'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import { notFound } from '@/server/core/errors'
import { ClaimDecision, FeatureOut, IdParam } from '@/server/schemas/admin-features'
import { crudRouter } from './_crud'
import * as repo from '@/server/repositories/admin-features/_generic-repo'

/**
 * /claim-reviews — CRUD over `claim_review` plus:
 *   POST `/{id}/decision` — record an admin decision on a claim.
 * See: docs/migration/07-domain-endpoints.md
 */

const COLL = 'claim_review'
const TAG = 'ClaimReviews'

export const claimReviews = crudRouter({ collection: COLL, tag: TAG, noun: 'claim review' })

claimReviews.use('/:id/decision', requireAdmin())
claimReviews.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/decision',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ClaimDecision } } },
    },
    responses: {
      200: { description: 'Decision recorded', content: { 'application/json': { schema: envelopeOf(FeatureOut) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const updated = await repo.updateDoc(COLL, id, {
      ...body,
      status: 'DECIDED',
      decidedBy: p.userId,
      decidedAt: Math.floor(Date.now() / 1000),
    })
    if (!updated) throw notFound('claim review not found')
    return c.json(ok(c, 'Claim decision recorded', FeatureOut.parse(updated)), 200)
  },
)
