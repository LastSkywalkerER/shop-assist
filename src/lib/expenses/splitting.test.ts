import { describe, it, expect } from 'vitest'
import type { CurrencyRateDocument } from '../../db/types'
import {
  lineItemTotal,
  computeShares,
  computeCategorySettlement,
  minimizeTransfers,
  buildItemTotals,
  creatorSplitInfo,
  annotateExpensesWithSplit,
  type ParticipantInput,
  type ExpenseInput,
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
    const t = minimizeTransfers([
      { name: 'A', net: 60 },
      { name: 'B', net: -40 },
      { name: 'C', net: -20 },
    ])
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

  it('applies recorded category repayments to balances and transfers', () => {
    // Two 300 bills paid by Костя and Maksim, split equally three ways:
    // each share 200, so Костя +100, Maksim +100, Оля -200.
    const expenses: ExpenseInput[] = [
      { id: 'e1', amount: 300, currency: 'BYN', creatorName: 'Костя' },
      { id: 'e2', amount: 300, currency: 'BYN', creatorName: 'Maksim' },
    ]
    const participantsByExpenseId = new Map<string, ParticipantInput[]>([
      ['e1', [
        p({ id: 'k1', name: 'Костя' }),
        p({ id: 'm1', name: 'Maksim' }),
        p({ id: 'o1', name: 'Оля' }),
      ]],
      ['e2', [
        p({ id: 'k2', name: 'Костя' }),
        p({ id: 'm2', name: 'Maksim' }),
        p({ id: 'o2', name: 'Оля' }),
      ]],
    ])
    const net = (r: ReturnType<typeof computeCategorySettlement>, name: string) =>
      r.perPerson.find((x) => x.name === name)!.net

    const before = computeCategorySettlement(expenses, participantsByExpenseId, new Map(), [])
    expect(net(before, 'Оля')).toBe(-200)
    expect(net(before, 'Костя')).toBe(100)
    expect(net(before, 'Maksim')).toBe(100)
    expect(before.transfers).toEqual([
      { from: 'Оля', to: 'Костя', amount: 100 },
      { from: 'Оля', to: 'Maksim', amount: 100 },
    ])

    // Оля repays Костя the full 100: that debt clears, only Maksim remains.
    const after = computeCategorySettlement(expenses, participantsByExpenseId, new Map(), [], [
      { from: 'Оля', to: 'Костя', amount: 100 },
    ])
    expect(net(after, 'Костя')).toBe(0)
    expect(net(after, 'Оля')).toBe(-100)
    expect(after.perPerson.find((x) => x.name === 'Оля')!.categoryPaid).toBe(100)
    expect(after.transfers).toEqual([{ from: 'Оля', to: 'Maksim', amount: 100 }])
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

describe('buildItemTotals', () => {
  it('groups line totals per expense via each receipt', () => {
    const totals = buildItemTotals(
      [
        { id: 'r1', expenseId: 'e1' },
        { id: 'r2', expenseId: 'e2' },
      ],
      [
        { id: 'i1', receiptId: 'r1', amount: 5, quantity: 2 }, // 10
        { id: 'i2', receiptId: 'r1', amount: 3 }, // 3 (quantity defaults to 1)
        { id: 'i3', receiptId: 'r2', amount: 7 },
      ],
    )
    expect(totals.get('e1')!.get('i1')).toBe(10)
    expect(totals.get('e1')!.get('i2')).toBe(3)
    expect(totals.get('e2')!.get('i3')).toBe(7)
  })
})

describe('creatorSplitInfo', () => {
  it('counts the creator at their own share for a split expense', () => {
    // Worked example: bill 100, creator Максим splits equally with the items case.
    const info = creatorSplitInfo(
      { id: 'e1', amount: 100, currency: 'BYN', creatorName: 'Максим', categoryId: 'food' },
      [
        p({ id: 'maxim', name: 'Максим' }),
        p({ id: 'olya', name: 'Оля', settledAmount: 25 }),
        p({ id: 'kostya', name: 'Костя', shareMode: 'items', itemIds: ['i1', 'i2'] }),
        p({ id: 'ilya', name: 'Илья' }),
      ],
      new Map([['i1', 5], ['i2', 10]]),
      [],
    )
    expect(info.isSplit).toBe(true)
    expect(info.categoryId).toBe('food')
    // 85 / 3 = 28.333..., first equal participant (the creator) absorbs the extra cent.
    expect(info.creatorShareNative).toBe(28.34)
    expect(info.creatorShareBase).toBe(28.34)
    expect(info.fullAmountBase).toBe(100)
    expect(info.conversionGap).toBe(false)
  })

  it('counts the full amount for a non-split (personal) expense', () => {
    const info = creatorSplitInfo(
      { id: 'e1', amount: 100, currency: 'BYN', creatorName: 'Максим', categoryId: 'food' },
      [],
      new Map(),
      [],
    )
    expect(info.isSplit).toBe(false)
    expect(info.creatorShareNative).toBe(100)
    expect(info.creatorShareBase).toBe(100)
  })

  it('counts zero when the creator only fronted money but did not consume', () => {
    const info = creatorSplitInfo(
      { id: 'e1', amount: 90, currency: 'BYN', creatorName: 'Максим' },
      [p({ id: 'a', name: 'Оля' }), p({ id: 'b', name: 'Илья' })],
      new Map(),
      [],
    )
    expect(info.isSplit).toBe(true)
    expect(info.creatorShareNative).toBe(0)
    expect(info.creatorShareBase).toBe(0)
    expect(info.conversionGap).toBe(false)
    // The full bill is still available for the payer view.
    expect(info.fullAmountBase).toBe(90)
  })

  it('matches the creator participant case-insensitively / trimmed', () => {
    const info = creatorSplitInfo(
      { id: 'e1', amount: 100, currency: 'BYN', creatorName: '  Максим ' },
      [p({ id: 'a', name: 'максим' }), p({ id: 'b', name: 'Оля' })],
      new Map(),
      [],
    )
    expect(info.creatorShareNative).toBe(50)
  })

  it('converts the creator share to the base currency', () => {
    const rates: CurrencyRateDocument[] = [
      { id: 'r1', currency: 'USD', date: '2026-06-01', rate: 3, scale: 1, createdAt: '', updatedAt: '' },
    ]
    const info = creatorSplitInfo(
      { id: 'e1', amount: 10, currency: 'USD', creatorName: 'Максим' },
      [p({ id: 'a', name: 'Максим' }), p({ id: 'b', name: 'Оля' })],
      new Map(),
      rates,
    )
    expect(info.creatorShareNative).toBe(5) // 10 USD split two ways
    expect(info.creatorShareBase).toBe(15) // 5 USD × 3
    expect(info.fullAmountBase).toBe(30)
    expect(info.conversionGap).toBe(false)
  })

  it('flags a conversion gap when the currency has no rate', () => {
    const info = creatorSplitInfo(
      { id: 'e1', amount: 10, currency: 'EUR', creatorName: 'Максим' },
      [p({ id: 'a', name: 'Максим' }), p({ id: 'b', name: 'Оля' })],
      new Map(),
      [],
    )
    expect(info.creatorShareBase).toBe(null)
    expect(info.fullAmountBase).toBe(null)
    expect(info.conversionGap).toBe(true)
  })
})

describe('annotateExpensesWithSplit', () => {
  it('keeps category (type) and isSplit (group) as orthogonal dimensions', () => {
    const expenses: ExpenseInput[] = [
      { id: 'e1', amount: 100, currency: 'BYN', creatorName: 'Максим', categoryId: 'food' },
      { id: 'e2', amount: 40, currency: 'BYN', creatorName: 'Максим', categoryId: 'food' },
      { id: 'e3', amount: 200, currency: 'BYN', creatorName: 'Максим', categoryId: 'travel' },
    ]
    const participantsByExpenseId = new Map<string, ParticipantInput[]>([
      ['e1', [p({ id: 'm', name: 'Максим' }), p({ id: 'o', name: 'Оля' })]],
      // e2 has no participants -> personal; e3 split travel.
      ['e3', [p({ id: 'm3', name: 'Максим' }), p({ id: 'i3', name: 'Илья' })]],
    ])

    const map = annotateExpensesWithSplit(expenses, participantsByExpenseId, new Map(), [])

    expect(map.get('e1')!.isSplit).toBe(true)
    expect(map.get('e1')!.creatorShareBase).toBe(50)
    expect(map.get('e2')!.isSplit).toBe(false)
    expect(map.get('e2')!.creatorShareBase).toBe(40)
    expect(map.get('e3')!.isSplit).toBe(true)
    expect(map.get('e3')!.creatorShareBase).toBe(100)

    // Consumer view: total the creator's cost by category (type), NOT lumping all
    // split together. Split rows count at the creator's share, personal at full.
    const byCategory = new Map<string, number>()
    for (const info of map.values()) {
      const prev = byCategory.get(info.categoryId!) ?? 0
      byCategory.set(info.categoryId!, prev + (info.creatorShareBase ?? 0))
    }
    expect(byCategory.get('food')).toBe(90) // 50 (split share) + 40 (personal)
    expect(byCategory.get('travel')).toBe(100) // 100 (split share)
  })
})
