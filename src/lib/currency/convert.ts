import type { CurrencyRateDocument } from '../../db/types'

/** Base currency that all NBRB rates are expressed against. */
export const BASE_CURRENCY = 'BYN'

/**
 * Pick the most recent rate document for each currency.
 * Rates are stored as `rate` BYN per `scale` units of the currency.
 */
export function buildLatestRateMap(
  rates: CurrencyRateDocument[],
): Map<string, CurrencyRateDocument> {
  const latest = new Map<string, CurrencyRateDocument>()
  for (const r of rates) {
    const cur = r.currency.toUpperCase()
    const existing = latest.get(cur)
    if (!existing || r.date > existing.date) latest.set(cur, r)
  }
  return latest
}

/**
 * Convert `amount` from `currency` into the base currency (BYN).
 * Returns `null` when no rate is available for a non-base currency, so callers
 * can surface a "conversion gap" warning instead of silently dropping money.
 */
export function convertToBase(
  amount: number,
  currency: string,
  rateMap: Map<string, CurrencyRateDocument>,
): number | null {
  const cur = (currency || BASE_CURRENCY).toUpperCase()
  if (cur === BASE_CURRENCY) return amount
  const rate = rateMap.get(cur)
  if (!rate || !rate.scale) return null
  return (amount * rate.rate) / rate.scale
}
