import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
} from '../../db/types'
import { SearchBar } from '../dashboard/SearchBar'
import { ExpenseCategoryFilter } from './ExpenseCategoryFilter'
import { ExpenseTable } from './ExpenseTable'
import { FAB } from '../shared/FAB'
import { ConfirmModal } from '../shared/ConfirmModal'
import type { ExpenseRowData } from './ExpenseRow'

export function ExpensesDashboard() {
  const [search, setSearch] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')

  const expenses = useRxQuery(expensesCol)
  const stores = useRxQuery(storesCol)
  const categories = useRxQuery(categoriesCol)
  const receipts = useRxQuery(receiptsCol)
  const receiptItems = useRxQuery(receiptItemsCol)
  const attachments = useRxQuery(attachmentsCol)

  const tableData: ExpenseRowData[] = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s]))
    const categoryMap = new Map(categories.map((c) => [c.id, c]))
    const receiptMap = new Map(receipts.map((r) => [r.expenseId, r]))

    // Count receipt items per receipt
    const receiptItemsCountMap = new Map<string, number>()
    for (const item of receiptItems) {
      receiptItemsCountMap.set(item.receiptId, (receiptItemsCountMap.get(item.receiptId) || 0) + 1)
    }

    // Check if receipt has attachments
    const receiptHasAttachmentsMap = new Map<string, boolean>()
    for (const att of attachments) {
      receiptHasAttachmentsMap.set(att.receiptId, true)
    }

    const query = search.toLowerCase()
    const filtered = expenses.filter((e) => {
      const matchesSearch =
        !query ||
        (e.name?.toLowerCase().includes(query) ?? false) ||
        (storeMap.get(e.storeId || '')?.name.toLowerCase().includes(query) ?? false)
      const matchesCategory = !selectedCategoryId || e.categoryId === selectedCategoryId
      return matchesSearch && matchesCategory
    })

    // Sort by date descending (newest first)
    const sorted = [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return sorted.map((expense): ExpenseRowData => {
      const receipt = receiptMap.get(expense.id)
      const receiptItemsCount = receipt ? (receiptItemsCountMap.get(receipt.id) || 0) : 0
      const hasAttachments = receipt ? (receiptHasAttachmentsMap.get(receipt.id) || false) : false

      return {
        expenseId: expense.id,
        name: expense.name,
        storeName: storeMap.get(expense.storeId || '')?.name,
        amount: expense.amount,
        currency: expense.currency,
        date: expense.date,
        categoryName: categoryMap.get(expense.categoryId || '')?.name,
        notes: expense.notes,
        hasAttachments,
        receiptItemsCount,
      }
    })
  }, [expenses, stores, categories, receipts, receiptItems, attachments, search, selectedCategoryId])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (!expensesCol || !receiptsCol || !receiptItemsCol || !attachmentsCol || selectedIds.size === 0) return
    setDeleting(true)
    try {
      for (const expenseId of selectedIds) {
        // Find receipt for this expense
        const receipt = receipts.find((r) => r.expenseId === expenseId)

        if (receipt) {
          // Delete receipt items
          const items = receiptItems.filter((i) => i.receiptId === receipt.id)
          for (const item of items) {
            const doc = await receiptItemsCol.findOne(item.id).exec()
            if (doc) await doc.remove()
          }

          // Delete attachments
          const atts = attachments.filter((a) => a.receiptId === receipt.id)
          for (const att of atts) {
            const doc = await attachmentsCol.findOne(att.id).exec()
            if (doc) await doc.remove()
          }

          // Delete receipt
          const receiptDoc = await receiptsCol.findOne(receipt.id).exec()
          if (receiptDoc) await receiptDoc.remove()
        }

        // Delete expense
        const expenseDoc = await expensesCol.findOne(expenseId).exec()
        if (expenseDoc) await expenseDoc.remove()
      }

      setSelectedIds(new Set())
      setSelectionMode(false)
    } catch (err) {
      console.error('Failed to delete expenses:', err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleLongPress = (id: string) => {
    // Activate selection mode and select the pressed item
    setSelectionMode(true)
    setSelectedIds(new Set([id]))
  }

  const handleCancelSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0">
        <SearchBar value={search} onChange={setSearch} />
        {categories.length > 0 && (
          <ExpenseCategoryFilter
            categories={categories}
            selected={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        )}
      </div>
      <div className="overflow-y-auto flex-1 pb-20">
        <ExpenseTable
          data={tableData}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onLongPress={handleLongPress}
        />
      </div>

      {/* FAB and delete button */}
      {selectionMode ? (
        <>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="fixed bottom-20 right-5 w-[52px] h-[52px] bg-destructive text-on-primary rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleCancelSelection}
            className="fixed bottom-20 left-5 px-4 py-2.5 bg-surface text-text rounded-2xl shadow-lg text-[15px] font-medium active:opacity-80 transition-opacity z-20"
          >
            Отмена
          </button>
        </>
      ) : (
        <FAB onClick={() => navigate('/expenses/add')} />
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <ConfirmModal
          title={`Удалить ${selectedIds.size} ${selectedIds.size === 1 ? 'расход' : 'расхода'}?`}
          message="Расходы будут удалены без возможности восстановления, включая все вложения и позиции чеков."
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          destructive
          confirmDisabled={deleting}
          onConfirm={handleDeleteSelected}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
