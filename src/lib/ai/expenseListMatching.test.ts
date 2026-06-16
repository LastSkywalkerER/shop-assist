import { describe, it, expect } from 'vitest'
import type { ExpenseDocument } from '../../db/types'
import type { ParsedExpenseRow } from './parseExpenseList'
import { matchParsedRow } from './expenseListMatching'

const exp = (over: Partial<ExpenseDocument> & { id: string; amount: number }): ExpenseDocument => ({
  currency: 'BYN',
  date: '2026-06-10T00:00:00.000Z',
  createdAt: '',
  updatedAt: '',
  ...over,
})

const row = (over: Partial<ParsedExpenseRow> & { amount: number }): ParsedExpenseRow => ({
  date: null,
  name: 'Расход',
  currency: null,
  matchedLabel: null,
  categoryName: null,
  confidence: 1,
  ...over,
})

describe('matchParsedRow', () => {
  it('matches an exact amount in the same currency', () => {
    const expenses = [exp({ id: 'a', amount: 45.2 })]
    const res = matchParsedRow(row({ amount: 45.2 }), 'BYN', expenses)
    expect(res.match?.id).toBe('a')
  })

  it('matches within ±1 currency unit', () => {
    const expenses = [exp({ id: 'a', amount: 45 })]
    expect(matchParsedRow(row({ amount: 45.9 }), 'BYN', expenses).match?.id).toBe('a')
    expect(matchParsedRow(row({ amount: 44.1 }), 'BYN', expenses).match?.id).toBe('a')
  })

  it('does not match when the amount delta exceeds 1', () => {
    const expenses = [exp({ id: 'a', amount: 45 })]
    expect(matchParsedRow(row({ amount: 46.5 }), 'BYN', expenses).match).toBeNull()
  })

  it('does not match across different currencies', () => {
    const expenses = [exp({ id: 'a', amount: 45, currency: 'USD' })]
    expect(matchParsedRow(row({ amount: 45 }), 'BYN', expenses).match).toBeNull()
  })

  it('honours a row-specific currency over the list default', () => {
    const expenses = [exp({ id: 'a', amount: 45, currency: 'USD' })]
    expect(matchParsedRow(row({ amount: 45, currency: 'USD' }), 'BYN', expenses).match?.id).toBe('a')
  })

  it('ranks the closest by date when several amounts qualify', () => {
    const expenses = [
      exp({ id: 'far', amount: 45, date: '2026-01-01T00:00:00.000Z' }),
      exp({ id: 'near', amount: 45, date: '2026-06-11T00:00:00.000Z' }),
    ]
    const res = matchParsedRow(row({ amount: 45, date: '2026-06-12' }), 'BYN', expenses)
    expect(res.match?.id).toBe('near')
    expect(res.alternates.map((e) => e.id)).toContain('far')
  })

  it('falls back to smallest amount delta when the row has no date', () => {
    const expenses = [
      exp({ id: 'closer', amount: 45.1 }),
      exp({ id: 'further', amount: 45.8 }),
    ]
    const res = matchParsedRow(row({ amount: 45 }), 'BYN', expenses)
    expect(res.match?.id).toBe('closer')
  })
})
