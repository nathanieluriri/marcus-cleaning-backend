import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Cleaners must be able to upload and manage documents (application
 * documents attached via routes/cleaner-applications.ts), not just
 * customers. Guard-level regression test: the /v1/documents routes that
 * mutate/read a single document must accept BOTH customer and cleaner
 * principals via `requireCustomerOrCleaner`, not the customer-only guard.
 */

const source = readFileSync(join(__dirname, '../server/routes/documents.ts'), 'utf8')

describe('documents route guards', () => {
  it('imports requireCustomerOrCleaner', () => {
    expect(source).toMatch(/import\s*\{[^}]*requireCustomerOrCleaner[^}]*\}\s*from\s*['"]@\/server\/security\/guards['"]/)
  })

  it('guards /upload-intents, /complete and /:document_id with requireCustomerOrCleaner (not the customer-only guard)', () => {
    const guardedLines = source
      .split('\n')
      .filter((line) => /documents\.use\((['"])(\/upload-intents|\/complete|\/:document_id)\1/.test(line))

    expect(guardedLines).toHaveLength(3)
    for (const line of guardedLines) {
      expect(line).toContain('requireCustomerOrCleaner()')
      expect(line).not.toMatch(/requireCustomer\(\)/)
    }
  })
})
