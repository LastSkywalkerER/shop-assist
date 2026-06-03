import { describe, it, expect } from 'vitest'
import type { CurrencyRateDocument } from '../../db/types'
import {
  lineItemTotal,
  computeShares,
  computeCategorySettlement,
  minimizeTransfers,
  type ParticipantInput,
  type ExpenseInput,
  type PersonBalance,
} from './splitting'

const p = (over: Partial<ParticipantInput> & { id: string; name: string }): ParticipantInput => ({
  shareMode: 'equal',
  ...over,
})

describe('lineItemTotal', () => {
  it('multiplies unit price by quantity (default 1)', () => {
    expect(lineItemTotal({ amount: 5 })).toBe(5)
    expect(lineItemTotal({ amount: 2.5, quantity: 3 })).toBe(7.5)
  })
})

describe('computeShares', () => {
  it('splits evenly with no fixed shares', () => {
    const r = computeShares(90, [
      p({ id: 'a', name: 'A' }),
      p({ id: 'b', name: 'B' }),
      p({ id: 'c', name: 'C' }),
    ])
    expect(r.shares.get('a')).toBe(30)
    expect(r.shares.get('b')).toBe(30)
    expect(r.shares.get('c')).toBe(30)
    expect(r.assigned).toBe(0)
    expect(r.remainder).toBe(90)
  })

  it('distributes rounding cents so equal shares sum exactly to the remainder', () => {
    const r = computeShares(100, [
      p({ id: 'a', name: 'A' }),
      p({ id: 'b', name: 'B' }),
      p({ id: 'c', name: 'C' }),
    ])
    const sum = r.shares.get('a')! + r.shares.get('b')! + r.shares.get('c')!
    expect(Math.round(sum * 100) / 100).toBe(100)
    // First participant absorbs the extra cent.
    expect(r.shares.get('a')).toBe(33.34)
    expect(r.shares.get('b')).toBe(33.33)
    expect(r.shares.get('c')).toBe(33.33)
  })

  it('handles the worked example: items + equal remainder', () => {
    const itemTotals = new Map<string, number>([
      ['i1', 5],
      ['i2', 10],
    ])
    const r = computeShares(
      100,
      [
        p({ id: 'maxim', name: 'Максим' }),
        p({ id: 'olya', name: 'Оля', settledAmount: 25 }),
        p({ id: 'kostya', name: 'Костя', shareMode: 'items', itemIds: ['i1', 'i2'] }),
        p({ id: 'ilya', name: 'Илья' }),
      ],
      itemTotals,
    )
    expect(r.assigned).toBe(15)
    expect(r.remainder).toBe(85)
    expect(r.shares.get('kostya')).toBe(15)
    // 85 / 3 = 28.333..., first equal participant absorbs the extra cent.
    expect(r.shares.get('maxim')).toBe(28.34)
    expect(r.shares.get('olya')).toBe(28.33)
    expect(r.shares.get('ilya')).toBe(28.33)
    expect(r.unassigned).toBe(0)
    expect(r.overAssigned).toBe(0)
  })

  it('flags an unassigned remainder when there is no equal participant', () => {
    const r = computeShares(100, [
      p({ id: 'a', name: 'A', shareMode: 'amount', shareAmount: 30 }),
    ])
    expect(r.assigned).toBe(30)
    expect(r.unassigned).toBe(70)
    expect(r.shares.get('a')).toBe(30)
  })

  it('flags over-assignment when fixed shares exceed the amount', () => {
    const r = computeShares(50, [
      p({ id: 'a', name: 'A', shareMode: 'amount', shareAmount: 40 }),
      p({ id: 'b', name: 'B', shareMode: 'amount', shareAmount: 30 }),
    ])
    expect(r.overAssigned).toBe(20)
    expect(r.remainder).toBe(-20)
  })
})

describe('minimizeTransfers', () => {
  it('matches debtors to creditors', () => {
    const balances: PersonBalance[] = [
      { name: 'A', paid: 0, share: 0, settled: 0, net: 60 },
      { name: 'B', paid: 0, share: 0, settled: 0, net: -40 },
      { name: 'C', paid: 0, share: 0, settled: 0, net: -20 },
    ]
    const t = minimizeTransfers(balances)
    expect(t).toEqual([
      { from: 'B', to: 'A', amount: 40 },
      { from: 'C', to: 'A', amount: 20 },
    ])
  })
})

describe('computeCategorySettlement', () => {
  const byn = (over: Partial<ExpenseInput> & { id: string }): ExpenseInput => ({
    amount: 0,
    currency: 'BYN',
    ...over,
  })

  it('settles the worked example to zero with minimal transfers', () => {
    const expense = byn({ id: 'e1', amount: 100, creatorName: 'Максим' })
    const participants: ParticipantInput[] = [
      p({ id: 'maxim', name: 'Максим' }),
      p({ id: 'olya', name: 'Оля', settledAmount: 25 }),
      p({ id: 'kostya', name: 'Костя', shareMode: 'items', itemIds: ['i1', 'i2'] }),
      p({ id: 'ilya', name: 'Илья' }),
    ]
    const result = computeCategorySettlement(
      [expense],
      new Map([['e1', participants]]),
      new Map([['e1', new Map([['i1', 5], ['i2', 10]])]]),
      [],
    )

    const net = (name: string) => result.perPerson.find((x) => x.name === name)!.net
    expect(net('Максим')).toBe(46.66)
    expect(net('Оля')).toBe(-3.33)
    expect(net('Костя')).toBe(-15)
    expect(net('Илья')).toBe(-28.33)
    // Whole category nets to zero.
    expect(Math.round(result.perPerson.reduce((s, x) => s + x.net, 0) * 100) / 100).toBe(0)

    expect(result.transfers).toEqual([
      { from: 'Илья', to: 'Максим', amount: 28.33 },
      { from: 'Костя', to: 'Максим', amount: 15 },
      { from: 'Оля', to: 'Максим', amount: 3.33 },
    ])
    expect(result.conversionGap).toBe(false)
  })

  it('converts multiple currencies to the base before aggregating', () => {
    const rates: CurrencyRateDocument[] = [
      {
        id: 'r1', currency: 'USD', date: '2026-06-01', rate: 3, scale: 1,
        createdAt: '', updatedAt: '',
      },
    ]
    const expenses: ExpenseInput[] = [
      { id: 'a', amount: 100, currency: 'BYN', creatorName: 'Максим' },
      { id: 'b', amount: 10, currency: 'USD', creatorName: 'Оля' },
    ]
    const result = computeCategorySettlement(
      expenses,
      new Map([
        ['a', [p({ id: 'm1', name: 'Максим' }), p({ id: 'o1', name: 'Оля' })]],
        ['b', [p({ id: 'o2', name: 'Оля' }), p({ id: 'm2', name: 'Максим' })]],
      ]),
      new Map(),
      rates,
    )
    const net = (name: string) => result.perPerson.find((x) => x.name === name)!.net
    // A: Maxim paid 100, each share 50. B: 10 USD = 30 BYN, Olya paid, each 15 BYN.
    // Maxim net = 100 - (50+15) = 35; Olya net = 30 - (50+15) = -35.
    expect(net('Максим')).toBe(35)
    expect(net('Оля')).toBe(-35)
    expect(result.transfers).toEqual([{ from: 'Оля', to: 'Максим', amount: 35 }])
    expect(result.conversionGap).toBe(false)
  })

  it('flags a conversion gap when a currency has no rate', () => {
    const result = computeCategorySettlement(
      [{ id: 'a', amount: 10, currency: 'EUR', creatorName: 'Максим' }],
      new Map([['a', [p({ id: 'm', name: 'Максим' }), p({ id: 'o', name: 'Оля' })]]]),
      new Map(),
      [],
    )
    expect(result.conversionGap).toBe(true)
  })

  it('skips expenses without a payer or participants', () => {
    const result = computeCategorySettlement(
      [
        { id: 'a', amount: 50, currency: 'BYN' },
        { id: 'b', amount: 50, currency: 'BYN', creatorName: 'Максим' },
      ],
      new Map([['b', []]]),
      new Map(),
      [],
    )
    expect(result.perPerson).toHaveLength(0)
  })
})
