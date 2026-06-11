import { z } from '@hono/zod-openapi'

export const PasswordResetRequest = z
  .object({ email: z.email().openapi({ example: 'ada@example.com' }) })
  .openapi('PasswordResetRequest')
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>

export const PasswordResetConfirm = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8).openapi({ example: 'sup3r-secret' }),
  })
  .openapi('PasswordResetConfirm')
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirm>
