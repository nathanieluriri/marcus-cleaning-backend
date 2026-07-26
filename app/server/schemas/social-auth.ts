import { z } from '@hono/zod-openapi'

/**
 * Native social sign-in — the app performs Google/Apple sign-in with the
 * Firebase (or Google) SDK and exchanges the resulting ID token here.
 *
 * One endpoint covers Android, iOS and web, and every provider wired into the
 * Firebase project, because what is verified is the token — not the platform.
 */

export const SocialSignInRequest = z
  .object({
    idToken: z.string().min(20).openapi({
      description:
        'ID token from the sign-in SDK. Firebase: `user.getIdToken()`. Bare Google Sign-In: the `idToken` from the credential. Apple is supported through Firebase.',
      example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFiNDcwZm...',
    }),
  })
  .openapi('SocialSignInRequest')
export type SocialSignInRequest = z.infer<typeof SocialSignInRequest>

export const SocialSignInOut = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().openapi({ example: 900 }),
    userId: z.string(),
    email: z.string(),
    /** True when this sign-in created the account — route to onboarding. */
    isNewUser: z.boolean(),
    /** Which identity provider was verified, e.g. `firebase:google.com`. */
    provider: z.string().openapi({ example: 'firebase:google.com' }),
  })
  .openapi('SocialSignInOut')
export type SocialSignInOut = z.infer<typeof SocialSignInOut>
