import type { CurrencyRateDocument } from '../../db/types'
import { convertBetween } from '../currency/convert'
import { lineItemTotal } from './splitting'

/** Minimal receipt-item shape needed to subtract a line from an expense. */
export interface DeductibleItem {
  amount: number
  quantity?: number
  currency?: string
}

export interface ItemDeduction {
  /**
   * Line total expressed in the expense currency, or null when the item is in
   * another currency and no rate is available — callers then delete the item
   * but leave the total alone rather than mixing currencies.
   */
  deducted: number | null
  /** Expense total after the deduction (unchanged when `deducted` is null). */
  nextAmount: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Work out what deleting a receipt item should do to the expense total:
 * subtract the item's line total (unit price × quantity), converted into the
 * expense currency, never dropping below zero.
 */
export function computeItemDeduction(
  item: DeductibleItem,
  expenseAmount: number,
  expenseCurrency: string,
  rateMap: Map<string, CurrencyRateDocument>,
): ItemDeduction {
  const line = lineItemTotal(item)
  const deducted = convertBetween(line, item.currency || expenseCurrency, expenseCurrency, rateMap)

  if (deducted === null) return { deducted: null, nextAmount: round2(expenseAmount) }

  return {
    deducted: round2(deducted),
    nextAmount: Math.max(0, round2(expenseAmount - deducted)),
  }
}
