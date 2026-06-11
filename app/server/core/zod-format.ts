import type { ZodError } from 'zod'

/**
 * Format Zod validation issues into the envelope `details` list.
 * Mirrors the shape produced by `core/validation_errors.py`.
 */
export function formatZodIssues(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.map(String).join('.') : '(body)',
    message: issue.message,
  }))
}
