import { describe, it, expect } from 'vitest'
import {
  dateKeyOf,
  resolveBounds,
  resolveGranularity,
  buildSpendingSeries,
  seriesAverage,
  seriesMaxKey,
  PieAccumulator,
  PIE_OTHER_LABEL,
  type AnalyticsPeriod,
} from './aggregate'

const TODAY = '2026-06-12'

describe('dateKeyOf', () => {
  it('produces a local YYYY-MM-DD key from an ISO datetime', () => {
    expect(dateKeyOf('2026-06-05T10:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('resolveBounds', () => {
  it('derives the all-time range from the data up to today', () => {
    const bounds = resolveBounds({ mode: 'all' }, ['2026-03-15', '2026-01-20', '2026-05-01'], TODAY)
    expect(bounds).toEqual({ fromKey: '2026-01-20', toKey: TODAY })
  })

  it('returns null for all-time with no data', () => {
    expect(resolveBounds({ mode: 'all' }, [], TODAY)).toBeNull()
  })

  it('covers the whole selected past month', () => {
    expect(resolveBounds({ mode: 'month', month: '2026-04' }, [], TODAY)).toEqual({
      fromKey: '2026-04-01',
      toKey: '2026-04-30',
    })
  })

  it('trims the current month at today', () => {
    expect(resolveBounds({ mode: 'month', month: '2026-06' }, [], TODAY)).toEqual({
      fromKey: '2026-06-01',
      toKey: TODAY,
    })
  })

  it('returns null for a reversed custom range', () => {
    expect(resolveBounds({ mode: 'range', from: '2026-06-10', to: '2026-06-01' }, [], TODAY)).toBeNull()
  })
})

describe('resolveGranularity', () => {
  it('is monthly for all-time and daily for a selected month', () => {
    expect(resolveGranularity({ mode: 'all' }, { fromKey: '2026-01-01', toKey: TODAY })).toBe('month')
    expect(resolveGranularity({ mode: 'month', month: '2026-06' }, { fromKey: '2026-06-01', toKey: TODAY })).toBe('day')
  })

  it('switches a custom range from daily to monthly beyond 62 days', () => {
    const short: AnalyticsPeriod = { mode: 'range', from: '2026-04-01', to: '2026-05-31' }
    const long: AnalyticsPeriod = { mode: 'range', from: '2026-03-01', to: '2026-05-31' }
    expect(resolveGranularity(short, { fromKey: short.from, toKey: short.to })).toBe('day')
    expect(resolveGranularity(long, { fromKey: long.from, toKey: long.to })).toBe('month')
  })
})

describe('buildSpendingSeries', () => {
  it('sums into month buckets and zero-fills the gaps', () => {
    const series = buildSpendingSeries(
      [
        { dateKey: '2026-01-10', amount: 10 },
        { dateKey: '2026-01-20', amount: 5 },
        { dateKey: '2026-03-01', amount: 7 },
      ],
      'month',
      { fromKey: '2026-01-10', toKey: '2026-03-31' },
    )
    expect(series.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(series.map((p) => p.total)).toEqual([15, 0, 7])
  })

  it('sums into day buckets within the bounds', () => {
    const series = buildSpendingSeries(
      [
        { dateKey: '2026-06-01', amount: 3 },
        { dateKey: '2026-06-01', amount: 2 },
        { dateKey: '2026-06-03', amount: 4 },
      ],
      'day',
      { fromKey: '2026-06-01', toKey: '2026-06-03' },
    )
    expect(series.map((p) => p.total)).toEqual([5, 0, 4])
    expect(series[0].label).toBe('01.06')
  })
})

describe('seriesAverage / seriesMaxKey', () => {
  const series = buildSpendingSeries(
    [
      { dateKey: '2026-01-10', amount: 30 },
      { dateKey: '2026-02-10', amount: 60 },
    ],
    'month',
    { fromKey: '2026-01-01', toKey: '2026-03-31' },
  )

  it('averages over all buckets including zero-filled ones', () => {
    expect(seriesAverage(series)).toBe(30)
  })

  it('finds the bucket with the maximum total', () => {
    expect(seriesMaxKey(series)).toBe('2026-02')
  })

  it('returns null max for an all-zero series', () => {
    expect(seriesMaxKey(buildSpendingSeries([], 'month', { fromKey: '2026-01-01', toKey: '2026-02-28' }))).toBeNull()
  })
})

describe('PieAccumulator', () => {
  it('groups names case-insensitively and keeps the first spelling', () => {
    const acc = new PieAccumulator()
    acc.add('Молоко', 2)
    acc.add('молоко ', 3)
    expect(acc.toPie()).toEqual([{ name: 'Молоко', value: 5 }])
  })

  it('keeps the top N and collapses the remainder into «Другое»', () => {
    const acc = new PieAccumulator()
    for (let i = 1; i <= 5; i++) acc.add(`item-${i}`, i)
    const pie = acc.toPie(3)
    expect(pie.map((p) => p.name)).toEqual(['item-5', 'item-4', 'item-3', PIE_OTHER_LABEL])
    expect(pie[3].value).toBe(3) // 1 + 2
  })

  it('omits «Другое» when there is no remainder', () => {
    const acc = new PieAccumulator()
    acc.add('a', 1)
    acc.add('b', 2)
    expect(acc.toPie(3).some((p) => p.name === PIE_OTHER_LABEL)).toBe(false)
  })

  it('ignores blank names', () => {
    const acc = new PieAccumulator()
    acc.add('  ', 5)
    expect(acc.toPie()).toEqual([])
  })
})
