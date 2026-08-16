import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import { useDragSelect } from '../../hooks/useDragSelect'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  StoreDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  CurrencyRateDocument,
} from '../../db/types'
import { ExpenseTable } from '../expenses/ExpenseTable'
import type { ExpenseRowData } from '../expenses/ExpenseRow'
import { useToast } from '../../contexts/ToastContext'
import { buildRateHistoryMap, convertToBaseAtDate } from '../../lib/currency/dateRates'
import { BASE_CURRENCY } from '../../lib/currency/convert'
import { dateKeyOf } from '../../lib/analytics/aggregate'
import { removeGroupDraft } from '../../lib/expenses/groupDrafts'
import { AddExpensesToGroupModal } from './AddExpensesToGroupModal'
import { pluralizeExpenses } from './pluralize'

/**
 * One expense group: its expenses, their total, and the two ways to edit
 * membership — «Добавить расходы» (picker over existing expenses) and a
 * long-press selection that removes the picked rows from the group.
 */
export function ExpenseGroupDetails() {
  const navigate = useNavigate()
  const params = useParams<{ groupName: string }>()
  const groupName = params.groupName ? decodeURIComponent(params.groupName) : ''
  const { showToast } = useToast()

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')

  const expenseQuery = useMemo(
    () => ({ selector: { groupName }, sort: [{ date: 'desc' as const }] }),
    [groupName],
  )
  const { data: expenses, loading } = useRxQuery(expensesCol, expenseQuery)
  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: attachments } = useRxQuery(attachmentsCol)
  const { data: rates } = useRxQuery(ratesCol)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const total = useMemo(() => {
    const history = buildRateHistoryMap(rates)
    let sum = 0
    for (const expense of expenses) {
      const base = convertToBaseAtDate(
        expense.amount,
        expense.currency,
        dateKeyOf(expense.date),
        history,
      )
      if (base !== null) sum += base
    }
    return sum
  }, [expenses, rates])

  const tableData: ExpenseRowData[] = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s]))
    const categoryMap = new Map(categories.map((c) => [c.id, c]))
    const receiptMap = new Map(receipts.map((r) => [r.expenseId, r]))

    const itemCounts = new Map<string, number>()
    for (const item of receiptItems) {
      itemCounts.set(item.receiptId, (itemCounts.get(item.receiptId) || 0) + 1)
    }
    const hasAttachmentsMap = new Map<string, boolean>()
    for (const att of attachments) hasAttachmentsMap.set(att.receiptId, true)

    return expenses.map((expense): ExpenseRowData => {
      const receipt = receiptMap.get(expense.id)
      return {
        expenseId: expense.id,
        name: expense.name,
        storeName: storeMap.get(expense.storeId || '')?.name,
        amount: expense.amount,
        currency: expense.currency,
        date: expense.date,
        categoryName: categoryMap.get(expense.categoryId || '')?.name,
        notes: expense.notes,
        hasAttachments: receipt ? hasAttachmentsMap.get(receipt.id) || false : false,
        receiptItemsCount: receipt ? itemCounts.get(receipt.id) || 0 : 0,
      }
    })
  }, [expenses, stores, categories, receipts, receiptItems, attachments])

  const addToSelection = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]))
  }, [])

  useDragSelect(selectionMode, addToSelection, 'data-expense-id')

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeSelected = async () => {
    if (!expensesCol || selectedIds.size === 0) return
    const now = new Date().toISOString()
    const count = selectedIds.size
    for (const id of selectedIds) {
      const doc = await expensesCol.findOne(id).exec()
      if (doc) await doc.patch({ groupName: undefined, updatedAt: now })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    showToast(`${pluralizeExpenses(count)} убрано из группы`, 'success')
  }

  if (!groupName) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 pb-2 flex items-center justify-between">
          <h2 className="text-[20px] font-bold text-text">Группа</h2>
          <button
            onClick={() => navigate(-1)}
            className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
          >
            Назад
          </button>
        </div>
        <div className="mx-4 bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
          Группа не найдена.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-4 pb-2 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-bold text-text truncate">{groupName}</h2>
        <button
          onClick={() => navigate(-1)}
          className="shrink-0 text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      <div className="px-4 pb-2 flex items-center gap-2">
        <div className="flex-1 bg-surface rounded-2xl px-4 py-3">
          <div className="text-[12px] text-text-hint">{pluralizeExpenses(expenses.length)}</div>
          <div className="text-[17px] font-bold text-text tabular-nums mt-0.5">
            {total.toFixed(2)} {BASE_CURRENCY}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="shrink-0 px-4 py-3 bg-primary text-on-primary rounded-2xl text-[14px] font-semibold active:opacity-80 transition-opacity"
        >
          Добавить расходы
        </button>
      </div>

      {expenses.length > 0 && !selectionMode && (
        <div className="px-5 pb-1 text-[11px] text-text-hint">
          Удерживайте расход, чтобы убрать его из группы.
        </div>
      )}

      <ExpenseTable
        data={tableData}
        loading={loading}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onLongPress={(id) => {
          setSelectionMode(true)
          setSelectedIds(new Set([id]))
        }}
      />

      {selectionMode && (
        <>
          {selectedIds.size > 0 && (
            <button
              onClick={() => void removeSelected()}
              className="fixed bottom-[88px] right-5 px-4 h-[52px] bg-destructive text-on-primary rounded-2xl shadow-lg flex items-center justify-center text-[15px] font-semibold active:scale-95 transition-transform z-20"
            >
              Убрать из группы
            </button>
          )}
          <button
            onClick={() => {
              setSelectionMode(false)
              setSelectedIds(new Set())
            }}
            className="fixed bottom-[88px] left-5 px-4 py-2.5 glass rounded-2xl border border-white/20 shadow-lg text-[15px] font-medium text-text active:opacity-80 transition-opacity z-20"
          >
            Отмена
          </button>
        </>
      )}

      {adding && (
        <AddExpensesToGroupModal
          groupName={groupName}
          onClose={() => setAdding(false)}
          onAdded={(count) => {
            // The group now exists through its expenses — drop the local draft.
            removeGroupDraft(groupName)
            showToast(`${pluralizeExpenses(count)} добавлено в группу`, 'success')
          }}
        />
      )}
    </div>
  )
}
