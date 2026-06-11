/**
 * Typed application errors → response envelope.
 * Ported from `core/errors.py` + `core/validation_errors.py`.
 *
 * Each error carries an HTTP status, a stable `code`, a (translatable) message,
 * and optional `details`. The app's `onError` handler converts these to the
 * standard envelope. See: ../../../docs/migration/04-api-layer.md
 */

export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const authInvalidToken = (details?: unknown) =>
  new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired token', details)

export const authRoleMismatch = (required: string, actual: string | null) =>
  new AppError(403, 'AUTH_ROLE_MISMATCH', 'Role not permitted', { required, actual })

export const forbidden = (message = 'Forbidden', details?: unknown) =>
  new AppError(403, 'FORBIDDEN', message, details)

export const notFound = (message = 'Not found', details?: unknown) =>
  new AppError(404, 'NOT_FOUND', message, details)

export const conflict = (message = 'Conflict', details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details)

export const badRequest = (message = 'Bad request', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details)

export const validationError = (details?: unknown) =>
  new AppError(422, 'VALIDATION_FAILED', 'Validation error', details)

export const tooManyRequests = (retryAfterSeconds: number, userType: string) =>
  new AppError(429, 'TOO_MANY_REQUESTS', 'Too Many Requests', {
    retry_after_seconds: retryAfterSeconds,
    user_type: userType,
  })
