import { useMemo } from 'react'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  SuperCategoryDocument,
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
  resolveBarGranularity,
  buildSpendingSeries,
  seriesAverage,
  seriesMaxKey,
  PieAccumulator,
  PIE_OTHER_LABEL,
  EMPTY_STACKED_SERIES,
  type AnalyticsPeriod,
  type Granularity,
  type SeriesPoint,
  type PieDatum,
  type StackedSeries,
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
  /** Stacked-bar counterparts of the pies (same groups, time-bucketed). */
  bars: {
    frequentItems: StackedSeries
    expensiveItems: StackedSeries
    frequentExpenses: StackedSeries
    expensiveExpenses: StackedSeries
    byCategory: StackedSeries
  }
  /** Bucket size of the bar charts: monthly above a one-month span, else daily. */
  barGranularity: Granularity
  /** Dimension of the byCategory pie: super categories by default, regular
   *  categories when a super category or explicit categories are selected. */
  byCategoryDimension: 'super' | 'category'
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
  superCategoryId: string | null = null,
): ExpenseAnalytics {
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const superCategoriesCol = useRxCollection<SuperCategoryDocument>('superCategories')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')

  const { data: expenses, loading } = useRxQuery(expensesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: superCategories } = useRxQuery(superCategoriesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)

  const categoryIdsKey = categoryIds.join(',')

  return useMemo(() => {
    const rateHistory = buildRateHistoryMap(rates)
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]))
    const storeNames = new Map(stores.map((s) => [s.id, s.name]))
    const superNames = new Map(superCategories.map((s) => [s.id, s.name]))

    // Effective category filter: explicit chips win; otherwise a selected
    // super category narrows the scope to its member categories.
    let categoryFilter: Set<string> | null = null
    if (categoryIds.length > 0) {
      categoryFilter = new Set(categoryIds)
    } else if (superCategoryId) {
      categoryFilter = new Set(
        categories.filter((c) => c.superCategoryId === superCategoryId).map((c) => c.id),
      )
    }

    // Default breakdown is by super category (when any exist); selecting a
    // super category or explicit categories switches it to regular categories.
    const byCategoryDimension: 'super' | 'category' =
      !superCategoryId && categoryIds.length === 0 && superCategories.length > 0
        ? 'super'
        : 'category'
    const categorySuper = new Map(categories.map((c) => [c.id, c.superCategoryId]))
    const categoryPieName = (catId: string | undefined): string => {
      if (!catId) return NO_CATEGORY_LABEL
      if (byCategoryDimension === 'category') return categoryNames.get(catId) ?? NO_CATEGORY_LABEL
      const superId = categorySuper.get(catId)
      return (superId ? superNames.get(superId) : undefined) ?? PIE_OTHER_LABEL
    }

    // Filter expenses by period bounds and selected categories.
    const allDateKeys = expenses.map((e) => dateKeyOf(e.date))
    const bounds = resolveBounds(period, allDateKeys)
    const granularity = resolveGranularity(period, bounds)
    const barGranularity = resolveBarGranularity(period, bounds)

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
        frequentExpenses.add(displayName, 1, dateKey)

        const amountBase = convertToBaseAtDate(expense.amount, expense.currency, dateKey, rateHistory)
        if (amountBase === null) {
          conversionGaps++
          continue
        }
        entries.push({ dateKey, amount: amountBase })
        expensiveExpenses.add(displayName, amountBase, dateKey)
        byCategory.add(categoryPieName(expense.categoryId), amountBase, dateKey)
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

      frequentItems.add(item.name, 1, dateKey)
      const totalBase = convertToBaseAtDate(lineItemTotal(item), item.currency, dateKey, rateHistory)
      if (totalBase === null) {
        conversionGaps++
        continue
      }
      expensiveItems.add(item.name, totalBase, dateKey)
    }

    const series = bounds ? buildSpendingSeries(entries, granularity, bounds) : []
    const toBars = (acc: PieAccumulator): StackedSeries =>
      bounds ? acc.toStackedSeries(barGranularity, bounds) : EMPTY_STACKED_SERIES

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
      bars: {
        frequentItems: toBars(frequentItems),
        expensiveItems: toBars(expensiveItems),
        frequentExpenses: toBars(frequentExpenses),
        expensiveExpenses: toBars(expensiveExpenses),
        byCategory: toBars(byCategory),
      },
      barGranularity,
      byCategoryDimension,
      conversionGaps,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, categories, superCategories, stores, receipts, receiptItems, rates, period, categoryIdsKey, superCategoryId, loading])
}
