import { useMemo } from 'react'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  StoreDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  CurrencyRateDocument,
} from '../db/types'
import { buildRateHistoryMap, convertToBaseAtDate } from '../lib/currency/dateRates'
import { lineItemTotal } from '../lib/expenses/splitting'
import {
  dateKeyOf,
  resolveBounds,
  resolveGranularity,
  buildSpendingSeries,
  seriesAverage,
  seriesMaxKey,
  PieAccumulator,
  type AnalyticsPeriod,
  type Granularity,
  type SeriesPoint,
  type PieDatum,
  type SpendingEntry,
} from '../lib/analytics/aggregate'

export interface ExpenseAnalytics {
  loading: boolean
  /** Null when the period has no resolvable bounds (no data / reversed range). */
  hasBounds: boolean
  granularity: Granularity
  series: SeriesPoint[]
  average: number
  maxKey: string | null
  pies: {
    frequentItems: PieDatum[]
    expensiveItems: PieDatum[]
    frequentExpenses: PieDatum[]
    expensiveExpenses: PieDatum[]
    byCategory: PieDatum[]
  }
  /** Amounts skipped because their currency had no stored rate. */
  conversionGaps: number
}

const NO_NAME_LABEL = 'Без названия'
const NO_CATEGORY_LABEL = 'Без категории'

/**
 * Aggregates expenses and receipt items into the analytics datasets. All
 * amounts are converted to BYN at the rate effective on the expense's date.
 * Period/category filtering happens client-side over one stable subscription
 * per collection (the same full-collection load the dashboard already does).
 */
export function useExpenseAnalytics(
  period: AnalyticsPeriod,
  categoryIds: string[],
): ExpenseAnalytics {
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')

  const { data: expenses, loading } = useRxQuery(expensesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)

  const categoryIdsKey = categoryIds.join(',')

  return useMemo(() => {
    const rateHistory = buildRateHistoryMap(rates)
    const categoryFilter = categoryIds.length > 0 ? new Set(categoryIds) : null
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]))
    const storeNames = new Map(stores.map((s) => [s.id, s.name]))

    // Filter expenses by period bounds and selected categories.
    const allDateKeys = expenses.map((e) => dateKeyOf(e.date))
    const bounds = resolveBounds(period, allDateKeys)
    const granularity = resolveGranularity(period, bounds)

    let conversionGaps = 0
    const entries: SpendingEntry[] = []
    const frequentExpenses = new PieAccumulator()
    const expensiveExpenses = new PieAccumulator()
    const byCategory = new PieAccumulator()
    /** expenseId -> its dateKey, for receipt-item filtering and rate lookup. */
    const includedExpenses = new Map<string, string>()

    if (bounds) {
      for (let i = 0; i < expenses.length; i++) {
        const expense = expenses[i]
        const dateKey = allDateKeys[i]
        if (dateKey < bounds.fromKey || dateKey > bounds.toKey) continue
        if (categoryFilter && (!expense.categoryId || !categoryFilter.has(expense.categoryId))) continue

        includedExpenses.set(expense.id, dateKey)

        const displayName =
          expense.name?.trim() ||
          (expense.storeId ? storeNames.get(expense.storeId) : undefined) ||
          NO_NAME_LABEL
        frequentExpenses.add(displayName, 1)

        const amountBase = convertToBaseAtDate(expense.amount, expense.currency, dateKey, rateHistory)
        if (amountBase === null) {
          conversionGaps++
          continue
        }
        entries.push({ dateKey, amount: amountBase })
        expensiveExpenses.add(displayName, amountBase)
        byCategory.add(
          (expense.categoryId ? categoryNames.get(expense.categoryId) : undefined) ?? NO_CATEGORY_LABEL,
          amountBase,
        )
      }
    }

    // Receipt items inherit the date (and the period/category filter) of
    // their parent expense: receiptId → receipt.expenseId → expense.
    const receiptExpenseId = new Map(receipts.map((r) => [r.id, r.expenseId]))
    const frequentItems = new PieAccumulator()
    const expensiveItems = new PieAccumulator()
    for (const item of receiptItems) {
      const expenseId = receiptExpenseId.get(item.receiptId)
      const dateKey = expenseId ? includedExpenses.get(expenseId) : undefined
      if (!dateKey) continue

      frequentItems.add(item.name, 1)
      const totalBase = convertToBaseAtDate(lineItemTotal(item), item.currency, dateKey, rateHistory)
      if (totalBase === null) {
        conversionGaps++
        continue
      }
      expensiveItems.add(item.name, totalBase)
    }

    const series = bounds ? buildSpendingSeries(entries, granularity, bounds) : []

    return {
      loading,
      hasBounds: bounds !== null,
      granularity,
      series,
      average: seriesAverage(series),
      maxKey: seriesMaxKey(series),
      pies: {
        frequentItems: frequentItems.toPie(),
        expensiveItems: expensiveItems.toPie(),
        frequentExpenses: frequentExpenses.toPie(),
        expensiveExpenses: expensiveExpenses.toPie(),
        byCategory: byCategory.toPie(),
      },
      conversionGaps,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, categories, stores, receipts, receiptItems, rates, period, categoryIdsKey, loading])
}
