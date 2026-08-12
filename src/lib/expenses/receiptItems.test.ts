import { describe, it, expect } from 'vitest'
import type { CurrencyRateDocument } from '../../db/types'
import { buildLatestRateMap } from '../currency/convert'
import { computeItemDeduction } from './receiptItems'

const rate = (currency: string, value: number): CurrencyRateDocument => ({
  id: `${currency}-2026-06-02`,
  currency,
  date: '2026-06-02',
  rate: value,
  scale: 1,
  createdAt: '',
  updatedAt: '',
})

const rateMap = buildLatestRateMap([rate('USD', 3.2)])
const emptyRates = buildLatestRateMap([])

describe('computeItemDeduction', () => {
  it('subtracts unit price × quantity', () => {
    const res = computeItemDeduction({ amount: 2.5, quantity: 3, currency: 'BYN' }, 100, 'BYN', emptyRates)
    expect(res.deducted).toBe(7.5)
    expect(res.nextAmount).toBe(92.5)
  })

  it('defaults a missing quantity to one and a missing currency to the expense currency', () => {
    const res = computeItemDeduction({ amount: 12.3 }, 50, 'BYN', emptyRates)
    expect(res.deducted).toBe(12.3)
    expect(res.nextAmount).toBe(37.7)
  })

  it('converts an item priced in another currency', () => {
    const res = computeItemDeduction({ amount: 10, quantity: 1, currency: 'USD' }, 100, 'BYN', rateMap)
    expect(res.deducted).toBe(32)
    expect(res.nextAmount).toBe(68)
  })

  it('leaves the total untouched when the rate is unknown', () => {
    const res = computeItemDeduction({ amount: 10, currency: 'EUR' }, 100, 'BYN', rateMap)
    expect(res.deducted).toBeNull()
    expect(res.nextAmount).toBe(100)
  })

  it('never drops the total below zero', () => {
    const res = computeItemDeduction({ amount: 80, quantity: 2 }, 100, 'BYN', emptyRates)
    expect(res.deducted).toBe(160)
    expect(res.nextAmount).toBe(0)
  })

  it('rounds away floating point noise', () => {
    const res = computeItemDeduction({ amount: 0.1, quantity: 3 }, 1, 'BYN', emptyRates)
    expect(res.deducted).toBe(0.3)
    expect(res.nextAmount).toBe(0.7)
  })
})
