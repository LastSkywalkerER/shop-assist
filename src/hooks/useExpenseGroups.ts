import { useMemo, useSyncExternalStore } from 'react'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { ExpenseDocument, CurrencyRateDocument } from '../db/types'
import { buildRateHistoryMap, convertToBaseAtDate } from '../lib/currency/dateRates'
import { dateKeyOf } from '../lib/analytics/aggregate'
import { getGroupDrafts, subscribeGroupDrafts } from '../lib/expenses/groupDrafts'

export interface ExpenseGroupSummary {
  /** Display spelling — the one first seen on an expense (or on the draft). */
  name: string
  count: number
  /** Sum of the group's expenses in the base currency (BYN). */
  total: number
  /** True while the group has no expenses yet (a device-local draft). */
  draft: boolean
}

/**
 * The list of expense groups, derived from `expense.groupName` plus the
 * still-empty local drafts. Names are matched case-insensitively; the first
 * spelling seen on an expense wins.
 */
export function useExpenseGroups(): { groups: ExpenseGroupSummary[]; loading: boolean } {
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')
  const { data: expenses, loading } = useRxQuery(expensesCol)
  const { data: rates } = useRxQuery(ratesCol)

  const drafts = useSyncExternalStore(subscribeGroupDrafts, getGroupDrafts)

  const groups = useMemo(() => {
    const history = buildRateHistoryMap(rates)
    const byKey = new Map<string, ExpenseGroupSummary>()

    for (const expense of expenses) {
      const name = expense.groupName?.trim()
      if (!name) continue
      const key = name.toLowerCase()
      const entry = byKey.get(key) ?? { name, count: 0, total: 0, draft: false }
      entry.count++
      const base = convertToBaseAtDate(
        expense.amount,
        expense.currency,
        dateKeyOf(expense.date),
        history,
      )
      if (base !== null) entry.total += base
      byKey.set(key, entry)
    }

    for (const draft of drafts) {
      const key = draft.trim().toLowerCase()
      if (!key || byKey.has(key)) continue
      byKey.set(key, { name: draft.trim(), count: 0, total: 0, draft: true })
    }

    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [expenses, rates, drafts])

  return { groups, loading }
}
