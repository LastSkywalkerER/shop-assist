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
  const sums = new Map<string, number>()
  for (const e of entries) {
    const key = granularity === 'month' ? e.dateKey.slice(0, 7) : e.dateKey
    sums.set(key, (sums.get(key) ?? 0) + e.amount)
  }

  const points: SeriesPoint[] = []
  if (granularity === 'month') {
    const fromMonth = bounds.fromKey.slice(0, 7)
    const toMonth = bounds.toKey.slice(0, 7)
    for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
      points.push({ key: m, label: monthLabel(m), total: round2(sums.get(m) ?? 0) })
    }
  } else {
    for (let d = bounds.fromKey; d <= bounds.toKey; d = addDays(d, 1)) {
      points.push({ key: d, label: dayLabel(d), total: round2(sums.get(d) ?? 0) })
    }
  }
  return points
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

/**
 * Accumulates name → value groups for pie charts. Names are matched
 * case-insensitively; the first-seen original spelling is displayed.
 */
export class PieAccumulator {
  private groups = new Map<string, { name: string; value: number }>()

  add(name: string, value: number): void {
    const key = name.trim().toLowerCase()
    if (!key) return
    const group = this.groups.get(key)
    if (group) group.value += value
    else this.groups.set(key, { name: name.trim(), value })
  }

  /** Top-N groups by value, with the remainder collapsed into «Другое». */
  toPie(topN: number = PIE_TOP_N): PieDatum[] {
    const sorted = [...this.groups.values()].sort((a, b) => b.value - a.value)
    const top = sorted.slice(0, topN).map((g) => ({ name: g.name, value: round2(g.value) }))
    const rest = sorted.slice(topN).reduce((sum, g) => sum + g.value, 0)
    if (rest > 0) top.push({ name: PIE_OTHER_LABEL, value: round2(rest) })
    return top
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}
