/**
 * Pure aggregation helpers for the analytics page. All dates are local-time
 * keys: 'YYYY-MM-DD' for days and 'YYYY-MM' for months, so buckets match what
 * the user sees in the expense table.
 */

export type AnalyticsPeriod =
  | { mode: 'all' }
  | { mode: 'month'; month: string /* YYYY-MM */ }
  | { mode: 'range'; from: string; to: string /* YYYY-MM-DD */ }

export type Granularity = 'month' | 'day'

export interface SeriesPoint {
  /** Bucket key: 'YYYY-MM' or 'YYYY-MM-DD'. */
  key: string
  /** Short axis label ('июн 26' or '05.06'). */
  label: string
  total: number
}

export interface PieDatum {
  name: string
  value: number
}

/** Time-bucketed breakdown for a stacked bar chart, aligned with the pie. */
export interface StackedSeries {
  /** Group names in the same order (and colors) as the pie slices. */
  names: string[]
  /** One point per bucket; values[i] belongs to names[i]. */
  points: { key: string; label: string; values: number[] }[]
}

/** Spending entry already converted to the base currency. */
export interface SpendingEntry {
  dateKey: string // YYYY-MM-DD
  amount: number
}

/** Max daily points that stay readable on a phone-width line chart. */
const MAX_DAILY_SPAN = 62

/** Pie slices kept before the remainder collapses into «Другое». */
export const PIE_TOP_N = 8

export const PIE_OTHER_LABEL = 'Другое'

/** Local-time 'YYYY-MM-DD' key for an ISO datetime string. */
export function dateKeyOf(isoDate: string): string {
  const d = new Date(isoDate)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local-time 'YYYY-MM-DD' key for today. */
export function todayKey(): string {
  return dateKeyOf(new Date().toISOString())
}

/** Inclusive day span between two 'YYYY-MM-DD' keys (same day = 1). */
function daySpan(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`)
  const to = new Date(`${toKey}T00:00:00`)
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateKeyOf(d.toISOString())
}

function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + months, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTH_LABEL_FMT = new Intl.DateTimeFormat('ru', { month: 'short', year: '2-digit' })

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return MONTH_LABEL_FMT.format(new Date(y, m - 1, 1)).replace(' г.', '')
}

function dayLabel(dateKey: string): string {
  return `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`
}

/**
 * Resolve the inclusive date-key bounds of a period. For 'all' the range is
 * derived from the data (first entry → today); empty data yields null.
 * A reversed custom range also yields null (the UI shows a hint instead).
 */
export function resolveBounds(
  period: AnalyticsPeriod,
  dataDateKeys: string[],
  today: string = todayKey(),
): { fromKey: string; toKey: string } | null {
  if (period.mode === 'month') {
    const from = `${period.month}-01`
    const end = lastDayOfMonth(period.month)
    // Trim the current month at today so zero-filled future days don't drag
    // the daily average down.
    return { fromKey: from, toKey: end < today ? end : today }
  }
  if (period.mode === 'range') {
    if (!period.from || !period.to || period.from > period.to) return null
    return { fromKey: period.from, toKey: period.to }
  }
  if (dataDateKeys.length === 0) return null
  let min = dataDateKeys[0]
  for (const key of dataDateKeys) {
    if (key < min) min = key
  }
  return { fromKey: min, toKey: today >= min ? today : min }
}

/**
 * Bucket granularity for the stacked bar charts: monthly bars for all-time
 * and ranges longer than a month, daily bars for a month and shorter.
 */
export function resolveBarGranularity(
  period: AnalyticsPeriod,
  bounds: { fromKey: string; toKey: string } | null,
): Granularity {
  if (period.mode === 'month') return 'day'
  if (period.mode === 'range' && bounds) {
    return daySpan(bounds.fromKey, bounds.toKey) <= 31 ? 'day' : 'month'
  }
  return 'month'
}

/** Bucket granularity for a resolved period. */
export function resolveGranularity(
  period: AnalyticsPeriod,
  bounds: { fromKey: string; toKey: string } | null,
): Granularity {
  if (period.mode === 'month') return 'day'
  if (period.mode === 'range' && bounds) {
    return daySpan(bounds.fromKey, bounds.toKey) <= MAX_DAILY_SPAN ? 'day' : 'month'
  }
  return 'month'
}

/**
 * Build the spending line-chart series: entries are summed into day or month
 * buckets, and every bucket between the bounds is present (zero-filled) so
 * the line is continuous.
 */
export function buildSpendingSeries(
  entries: SpendingEntry[],
  granularity: Granularity,
  bounds: { fromKey: string; toKey: string },
): SeriesPoint[] {
  const sums = bucketSums(
    entries.map((e) => [e.dateKey, e.amount]),
    granularity,
  )
  return bucketsBetween(granularity, bounds).map(({ key, label }) => ({
    key,
    label,
    total: round2(sums.get(key) ?? 0),
  }))
}

/** Every bucket key/label between the bounds, inclusive. */
function bucketsBetween(
  granularity: Granularity,
  bounds: { fromKey: string; toKey: string },
): { key: string; label: string }[] {
  const buckets: { key: string; label: string }[] = []
  if (granularity === 'month') {
    const toMonth = bounds.toKey.slice(0, 7)
    for (let m = bounds.fromKey.slice(0, 7); m <= toMonth; m = addMonths(m, 1)) {
      buckets.push({ key: m, label: monthLabel(m) })
    }
  } else {
    for (let d = bounds.fromKey; d <= bounds.toKey; d = addDays(d, 1)) {
      buckets.push({ key: d, label: dayLabel(d) })
    }
  }
  return buckets
}

/** Sum (dateKey, value) pairs into day or month buckets. */
function bucketSums(pairs: Iterable<[string, number]>, granularity: Granularity): Map<string, number> {
  const sums = new Map<string, number>()
  for (const [dateKey, value] of pairs) {
    const key = granularity === 'month' ? dateKey.slice(0, 7) : dateKey
    sums.set(key, (sums.get(key) ?? 0) + value)
  }
  return sums
}

/** Mean of bucket totals (zero buckets included). */
export function seriesAverage(series: SeriesPoint[]): number {
  if (series.length === 0) return 0
  return round2(series.reduce((sum, p) => sum + p.total, 0) / series.length)
}

/** Key of the bucket with the highest total; null when everything is zero. */
export function seriesMaxKey(series: SeriesPoint[]): string | null {
  let max: SeriesPoint | null = null
  for (const p of series) {
    if (p.total > 0 && (!max || p.total > max.total)) max = p
  }
  return max?.key ?? null
}

interface PieGroup {
  name: string
  value: number
  /** Per-day totals, for the stacked bar series. */
  byDate: Map<string, number>
}

/**
 * Accumulates name → value groups for pie charts. Names are matched
 * case-insensitively; the first-seen original spelling is displayed.
 * A group named «Другое» (however accumulated) never competes for the
 * top-N — it is merged with the overflow remainder and always shown last.
 */
export class PieAccumulator {
  private groups = new Map<string, PieGroup>()

  add(name: string, value: number, dateKey?: string): void {
    const key = name.trim().toLowerCase()
    if (!key) return
    let group = this.groups.get(key)
    if (!group) {
      group = { name: name.trim(), value: 0, byDate: new Map() }
      this.groups.set(key, group)
    }
    group.value += value
    if (dateKey) group.byDate.set(dateKey, (group.byDate.get(dateKey) ?? 0) + value)
  }

  /** Top-N named groups plus everything else destined for «Другое». */
  private split(topN: number): { top: PieGroup[]; rest: PieGroup[] } {
    const otherKey = PIE_OTHER_LABEL.toLowerCase()
    const sorted = [...this.groups.entries()]
      .filter(([key]) => key !== otherKey)
      .map(([, g]) => g)
      .sort((a, b) => b.value - a.value)
    const top = sorted.slice(0, topN)
    const rest = sorted.slice(topN)
    const other = this.groups.get(otherKey)
    if (other) rest.push(other)
    return { top, rest }
  }

  /** Top-N groups by value, with the remainder collapsed into «Другое». */
  toPie(topN: number = PIE_TOP_N): PieDatum[] {
    const { top, rest } = this.split(topN)
    const pie = top.map((g) => ({ name: g.name, value: round2(g.value) }))
    const restTotal = rest.reduce((sum, g) => sum + g.value, 0)
    if (restTotal > 0) pie.push({ name: PIE_OTHER_LABEL, value: round2(restTotal) })
    return pie
  }

  /**
   * Same groups as `toPie` (same order, so chart colors match), but spread
   * over time buckets for a stacked bar chart. Buckets are zero-filled.
   */
  toStackedSeries(
    granularity: Granularity,
    bounds: { fromKey: string; toKey: string },
    topN: number = PIE_TOP_N,
  ): StackedSeries {
    const { top, rest } = this.split(topN)
    const names = top.map((g) => g.name)
    const groupSums = top.map((g) => bucketSums(g.byDate, granularity))

    const restTotal = rest.reduce((sum, g) => sum + g.value, 0)
    if (restTotal > 0) {
      names.push(PIE_OTHER_LABEL)
      const merged: [string, number][] = rest.flatMap((g) => [...g.byDate])
      groupSums.push(bucketSums(merged, granularity))
    }

    const points = bucketsBetween(granularity, bounds).map(({ key, label }) => ({
      key,
      label,
      values: groupSums.map((sums) => round2(sums.get(key) ?? 0)),
    }))
    return { names, points }
  }
}

/** Empty stacked series for periods without resolvable bounds. */
export const EMPTY_STACKED_SERIES: StackedSeries = { names: [], points: [] }

function round2(x: number): number {
  return Math.round(x * 100) / 100
}
