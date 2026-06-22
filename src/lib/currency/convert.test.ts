import { describe, it, expect } from 'vitest'
import type { CurrencyRateDocument } from '../../db/types'
import { buildLatestRateMap, convertToBase, BASE_CURRENCY } from './convert'

const rate = (over: Partial<CurrencyRateDocument> & { currency: string; date: string }): CurrencyRateDocument => ({
  id: `${over.currency}-${over.date}`,
  rate: 1,
  scale: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('buildLatestRateMap', () => {
  it('keeps the most recent rate per currency', () => {
    const map = buildLatestRateMap([
      rate({ currency: 'USD', date: '2026-06-01', rate: 3 }),
      rate({ currency: 'USD', date: '2026-06-02', rate: 3.2 }),
      rate({ currency: 'EUR', date: '2026-06-01', rate: 3.5 }),
    ])
    expect(map.get('USD')!.rate).toBe(3.2)
    expect(map.get('EUR')!.rate).toBe(3.5)
  })
})

describe('convertToBase', () => {
  // `rate` is stored as BYN per 1 unit; `scale` is audit-only and ignored.
  const map = buildLatestRateMap([
    rate({ currency: 'USD', date: '2026-06-02', rate: 3.2, scale: 1 }),
    rate({ currency: 'RUB', date: '2026-06-02', rate: 0.034, scale: 100 }),
  ])

  it('returns the amount unchanged for the base currency', () => {
    expect(convertToBase(42, BASE_CURRENCY, map)).toBe(42)
    expect(convertToBase(42, 'byn', map)).toBe(42)
  })

  it('multiplies by the per-unit rate and ignores scale', () => {
    expect(convertToBase(10, 'USD', map)).toBeCloseTo(32, 5)
    expect(convertToBase(1000, 'RUB', map)).toBeCloseTo(34, 5)
  })

  it('returns null when no rate is available', () => {
    expect(convertToBase(10, 'EUR', map)).toBeNull()
  })
})
