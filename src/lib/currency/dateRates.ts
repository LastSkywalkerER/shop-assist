import type { CurrencyRateDocument } from '../../db/types'
import { BASE_CURRENCY } from './convert'

/** currency (uppercased) -> rate docs sorted ascending by date (YYYY-MM-DD). */
export type RateHistoryMap = Map<string, CurrencyRateDocument[]>

/**
 * Group rates by currency and sort each history by date, so a rate can be
 * looked up for an arbitrary day (analytics converts every expense at the
 * rate of its own date, not the latest one).
 */
export function buildRateHistoryMap(rates: CurrencyRateDocument[]): RateHistoryMap {
  const map: RateHistoryMap = new Map()
  for (const r of rates) {
    const cur = r.currency.toUpperCase()
    const list = map.get(cur)
    if (list) list.push(r)
    else map.set(cur, [r])
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
  }
  return map
}

/**
 * Convert `amount` from `currency` into the base currency (BYN) using the
 * rate effective on `date` (YYYY-MM-DD): the latest stored rate at or before
 * that day. Amounts dated before the first stored rate fall back to the
 * earliest rate (better than dropping the money entirely). Returns `null`
 * when the currency has no rates at all, so callers can surface a
 * "conversion gap" instead of silently losing the amount.
 */
export function convertToBaseAtDate(
  amount: number,
  currency: string,
  date: string,
  history: RateHistoryMap,
): number | null {
  const cur = (currency || BASE_CURRENCY).toUpperCase()
  if (cur === BASE_CURRENCY) return amount

  const list = history.get(cur)
  if (!list || list.length === 0) return null

  // Binary search: index of the latest entry with entry.date <= date.
  let lo = 0
  let hi = list.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].date <= date) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const rate = found >= 0 ? list[found] : list[0]
  // `rate` is BYN per 1 unit already; the NBRB `scale` is audit-only.
  return amount * rate.rate
}
