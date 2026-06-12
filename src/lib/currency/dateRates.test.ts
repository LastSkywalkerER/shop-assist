import { describe, it, expect } from 'vitest'
import type { CurrencyRateDocument } from '../../db/types'
import { BASE_CURRENCY } from './convert'
import { buildRateHistoryMap, convertToBaseAtDate } from './dateRates'

const rate = (over: Partial<CurrencyRateDocument> & { currency: string; date: string }): CurrencyRateDocument => ({
  id: `${over.currency}-${over.date}`,
  rate: 1,
  scale: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('buildRateHistoryMap', () => {
  it('groups by uppercased currency and sorts each history by date', () => {
    const map = buildRateHistoryMap([
      rate({ currency: 'usd', date: '2026-06-03', rate: 3.3 }),
      rate({ currency: 'USD', date: '2026-06-01', rate: 3.1 }),
      rate({ currency: 'EUR', date: '2026-06-02', rate: 3.5 }),
    ])
    expect(map.get('USD')!.map((r) => r.date)).toEqual(['2026-06-01', '2026-06-03'])
    expect(map.get('EUR')).toHaveLength(1)
  })
})

describe('convertToBaseAtDate', () => {
  const history = buildRateHistoryMap([
    rate({ currency: 'USD', date: '2026-06-01', rate: 3.0 }),
    rate({ currency: 'USD', date: '2026-06-05', rate: 3.2 }),
    rate({ currency: 'USD', date: '2026-06-10', rate: 3.4 }),
    rate({ currency: 'RUB', date: '2026-06-01', rate: 3.4, scale: 100 }),
  ])

  it('returns the amount unchanged for the base currency', () => {
    expect(convertToBaseAtDate(42, BASE_CURRENCY, '2026-06-05', history)).toBe(42)
    expect(convertToBaseAtDate(42, 'byn', '2026-06-05', history)).toBe(42)
    expect(convertToBaseAtDate(42, '', '2026-06-05', history)).toBe(42)
  })

  it('uses the rate stored exactly on the requested date', () => {
    expect(convertToBaseAtDate(10, 'USD', '2026-06-05', history)).toBeCloseTo(32, 5)
  })

  it('falls back to the nearest earlier rate', () => {
    expect(convertToBaseAtDate(10, 'USD', '2026-06-07', history)).toBeCloseTo(32, 5)
    expect(convertToBaseAtDate(10, 'USD', '2026-12-31', history)).toBeCloseTo(34, 5)
  })

  it('falls back to the earliest rate for dates before the first one', () => {
    expect(convertToBaseAtDate(10, 'USD', '2025-01-01', history)).toBeCloseTo(30, 5)
  })

  it('applies the NBRB scale', () => {
    expect(convertToBaseAtDate(1000, 'RUB', '2026-06-05', history)).toBeCloseTo(34, 5)
  })

  it('returns null when the currency has no rates at all', () => {
    expect(convertToBaseAtDate(10, 'EUR', '2026-06-05', history)).toBeNull()
  })

  it('returns null when the stored scale is falsy', () => {
    const broken = buildRateHistoryMap([rate({ currency: 'PLN', date: '2026-06-01', rate: 0.9, scale: 0 })])
    expect(convertToBaseAtDate(10, 'PLN', '2026-06-05', broken)).toBeNull()
  })
})
