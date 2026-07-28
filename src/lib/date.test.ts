import { describe, it, expect } from 'vitest'
import { toDateInputValue, withDatePart } from './date'

describe('toDateInputValue', () => {
  it('takes the calendar-date part of an ISO timestamp', () => {
    expect(toDateInputValue('2026-07-28T14:35:12.345Z')).toBe('2026-07-28')
  })

  it('returns an empty string for a missing timestamp', () => {
    expect(toDateInputValue(undefined)).toBe('')
  })
})

describe('withDatePart', () => {
  const original = '2026-07-28T14:35:12.345Z'

  it('returns the original timestamp when the day is unchanged', () => {
    expect(withDatePart(original, toDateInputValue(original))).toBe(original)
  })

  it('changes only the day and keeps the time of day', () => {
    expect(withDatePart(original, '2026-07-30')).toBe('2026-07-30T14:35:12.345Z')
  })

  it('keeps a non-UTC offset', () => {
    expect(withDatePart('2026-07-28T14:35:00+03:00', '2026-08-01')).toBe('2026-08-01T14:35:00+03:00')
  })

  it('falls back to the start of the day for a date-only original', () => {
    expect(withDatePart('2026-07-28', '2026-07-30')).toBe('2026-07-30T00:00:00.000Z')
  })

  it('falls back to the start of the day when there is no original', () => {
    expect(withDatePart(undefined, '2026-07-30')).toBe('2026-07-30T00:00:00.000Z')
  })

  it('keeps the original when the input is cleared', () => {
    expect(withDatePart(original, '')).toBe(original)
  })
})
