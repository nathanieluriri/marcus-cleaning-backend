import { describe, expect, it } from 'vitest'
import { splitFullName } from '@/server/schemas/cleaner-job'

describe('splitFullName', () => {
  it('splits first token as firstName, remainder as lastName', () => {
    expect(splitFullName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    expect(splitFullName('Ada King Lovelace')).toEqual({ firstName: 'Ada', lastName: 'King Lovelace' })
  })

  it('handles a single token', () => {
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
  })

  it('trims surrounding whitespace', () => {
    expect(splitFullName('  Ada  Lovelace  ')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })
})
