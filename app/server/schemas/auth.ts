import { z } from '@hono/zod-openapi'

/**
 * Shared auth/token contracts.
 *
 * NOTE (contract parity): the legacy FastAPI token output used inconsistent
 * casing (`accesstoken`/`refreshtoken` in some models, `accessToken`/`refreshToken`
 * in others). This canonical shape uses camelCase. Confirm against the mobile
 * clients before cutover — see docs/migration/15-open-questions-risks.md.
 */

export const TokenResponse = z
  .object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    refreshToken: z.string().openapi({ example: 'b3BhcXVlLXJlZnJlc2gtdG9rZW4' }),
    tokenType: z.literal('Bearer').default('Bearer'),
    expiresIn: z.number().int().openapi({ example: 900, description: 'Access token TTL in seconds' }),
    language: z.enum(['en', 'fr']).openapi({ example: 'en' }),
  })
  .openapi('TokenResponse')
export type TokenResponse = z.infer<typeof TokenResponse>

export const RefreshRequest = z
  .object({
    // Accept both legacy aliases for parity.
    refreshToken: z.string().optional(),
    refresh_token: z.string().optional(),
  })
  .refine((v) => Boolean(v.refreshToken ?? v.refresh_token), {
    message: 'refreshToken is required',
  })
  .openapi('RefreshRequest')
export type RefreshRequest = z.infer<typeof RefreshRequest>

export function readRefreshToken(body: RefreshRequest): string {
  return (body.refreshToken ?? body.refresh_token)!
}
