import { useMemo } from 'react'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type {
  ExpenseDocument,
  ExpenseParticipantDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  CurrencyRateDocument,
} from '../db/types'
import {
  annotateExpensesWithSplit,
  buildItemTotals,
  type ExpenseInput,
  type ExpenseSplitInfo,
  type ParticipantInput,
} from '../lib/expenses/splitting'

/**
 * Live, read-only map of `expenseId -> ExpenseSplitInfo` for every expense.
 *
 * This is the single reuse seam a future personal-stats screen consumes: each
 * entry carries the expense's `categoryId` (type) plus the derived `isSplit`
 * (group) and the creator's own share (`creatorShareBase`). Recomputes
 * automatically when expenses, participants, receipts or rates change.
 *
 * It renders nothing on its own — purely a data hook.
 */
export function useExpenseSplitInfo(): Map<string, ExpenseSplitInfo> {
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)

  return useMemo(() => {
    const expenseInputs: ExpenseInput[] = expenses.map((e) => ({
      id: e.id,
      amount: e.amount,
      currency: e.currency,
      creatorName: e.creatorName,
      categoryId: e.categoryId,
    }))

    const participantsByExpenseId = new Map<string, ParticipantInput[]>()
    for (const p of allParticipants) {
      const list = participantsByExpenseId.get(p.expenseId) ?? []
      list.push({
        id: p.id,
        name: p.name,
        shareMode: p.shareMode,
        shareAmount: p.shareAmount,
        itemIds: p.itemIds,
        settledAmount: p.settledAmount,
      })
      participantsByExpenseId.set(p.expenseId, list)
    }

    const itemTotalsByExpenseId = buildItemTotals(receipts, receiptItems)

    return annotateExpensesWithSplit(expenseInputs, participantsByExpenseId, itemTotalsByExpenseId, rates)
  }, [expenses, allParticipants, receipts, receiptItems, rates])
}
