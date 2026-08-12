import { useState, useMemo, useCallback, useRef } from 'react'
import type { MangoQuery } from 'rxdb'
import { useRxCollection, useRxPaginatedQuery, useRxQuery } from '../../db/hooks'
import { useDragSelect } from '../../hooks/useDragSelect'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ExpenseParticipantDocument,
} from '../../db/types'
import { ExpenseCategoryFilter } from './ExpenseCategoryFilter'
import { ExpenseTable } from './ExpenseTable'
import { ExpenseQuickAddBar } from './ExpenseQuickAddBar'
import { ConfirmModal } from '../shared/ConfirmModal'
import type { ExpenseRowData } from './ExpenseRow'
import { blobStoreRemove } from '../../db/blobStore'
import { useAiSettings } from '../../contexts/AiSettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { ScanReceiptFlow } from './ScanReceiptFlow'
import { BulkExpenseUploadFlow } from './BulkExpenseUploadFlow'
import { PendingScanRow } from './PendingScanRow'
import { usePendingScans } from '../../hooks/usePendingScans'
import { GroupPickerModal } from '../groups/GroupPickerModal'
import { pluralizeExpenses } from '../groups/pluralize'
import { useToast } from '../../contexts/ToastContext'

export function ExpensesDashboard() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [quickCalcOpen, setQuickCalcOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)

  // Long-press on the scan FAB reveals the (hidden) bulk expense-list import;
  // a normal tap still opens the receipt scanner.
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const startScanPress = () => {
    longPressFired.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      setBulkOpen(true)
    }, 500)
  }
  const cancelScanPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  const handleScanClick = () => {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    setScanning(true)
  }

  const { aiEnabled } = useAiSettings()
  const { showToast } = useToast()
  const { roomId } = useAuth()
  const pendingScans = usePendingScans(roomId)

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')

  const buildPagedExpenseQuery = useCallback(
    (limit: number): MangoQuery<ExpenseDocument> => ({
      selector: selectedCategoryId ? { categoryId: selectedCategoryId } : {},
      sort: [{ date: 'desc' }],
      limit,
    }),
    [selectedCategoryId],
  )

  const {
    data: expenses,
    loading: expensesLoading,
    hasMore,
    loadMore,
  } = useRxPaginatedQuery(expensesCol, buildPagedExpenseQuery, {
    pageSize: 50,
    resetKey: selectedCategoryId ?? 'all',
  })

  /** Bounded slice for name suggestions in the quick-add bar (full collection not required). */
  const { data: expensesForQuickAdd } = useRxQuery(expensesCol, {
    sort: [{ date: 'desc' }],
    limit: 400,
  })

  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: attachments } = useRxQuery(attachmentsCol)
  const { data: participants } = useRxQuery(participantsCol)

  // Newest categories first (left) in the filter chips; sorted in memory
  // because createdAt is not indexed in the category schema.
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [categories],
  )

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

    return expenses.map((expense): ExpenseRowData => {
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
        groupName: expense.groupName,
        notes: expense.notes,
        hasAttachments,
        receiptItemsCount,
      }
    })
  }, [expenses, stores, categories, receipts, receiptItems, attachments])

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
        // Delete split participants
        if (participantsCol) {
          const parts = participants.filter((p) => p.expenseId === expenseId)
          for (const part of parts) {
            const doc = await participantsCol.findOne(part.id).exec()
            if (doc) await doc.remove()
          }
        }

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
            blobStoreRemove(att.id).catch(() => {})
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

  /** Bulk «в группу»: assign (or clear) the group of the selected expenses. */
  const handleAssignGroup = async (groupName: string | null) => {
    if (!expensesCol || selectedIds.size === 0) return
    const now = new Date().toISOString()
    const count = selectedIds.size
    for (const id of selectedIds) {
      const doc = await expensesCol.findOne(id).exec()
      if (doc) await doc.patch({ groupName: groupName ?? undefined, updatedAt: now })
    }
    setGroupPickerOpen(false)
    setSelectedIds(new Set())
    setSelectionMode(false)
    showToast(
      groupName
        ? `${pluralizeExpenses(count)} добавлено в группу «${groupName}»`
        : `${pluralizeExpenses(count)} убрано из группы`,
      'success',
    )
  }

  const handleLongPress = (id: string) => {
    setSelectionMode(true)
    setSelectedIds(new Set([id]))
  }

  const addToSelection = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]))
  }, [])

  useDragSelect(selectionMode, addToSelection, 'data-expense-id')

  const handleCancelSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="glass-strong sticky top-0 z-10 border-b border-separator/15 pt-3">
        {expensesLoading ? (
          <div className="px-4 pb-2.5 flex gap-2">
            {[48, 64, 56].map((w, i) => (
              <div key={i} className="h-7 rounded-full animate-pulse bg-text/10 shrink-0" style={{ width: w }} />
            ))}
          </div>
        ) : categories.length > 0 && (
          <ExpenseCategoryFilter
            categories={sortedCategories}
            selected={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        )}
      </div>
      {pendingScans.length > 0 && (
        <div className="px-4 py-2 space-y-2 border-b border-separator/15">
          {pendingScans.map((s) => (
            <PendingScanRow key={s.id} scan={s} />
          ))}
        </div>
      )}
      <ExpenseTable
        data={tableData}
        loading={expensesLoading}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onLongPress={handleLongPress}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />

      {/* FAB and delete button */}
      {selectionMode ? (
        <>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setGroupPickerOpen(true)}
              title="В группу"
              className="fixed bottom-[152px] right-5 w-[52px] h-[52px] bg-surface border border-separator/40 text-primary-text rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="fixed bottom-[88px] right-5 w-[52px] h-[52px] bg-destructive text-on-primary rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
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
            className="fixed bottom-[88px] left-5 px-4 py-2.5 glass rounded-2xl border border-white/20 shadow-lg text-[15px] font-medium text-text active:opacity-80 transition-opacity z-20"
          >
            Отмена
          </button>
        </>
      ) : (
        <>
          {aiEnabled && (
            <button
              type="button"
              onClick={handleScanClick}
              onPointerDown={startScanPress}
              onPointerUp={cancelScanPress}
              onPointerLeave={cancelScanPress}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Сканировать чек"
              title="Сканировать чек (удерживайте — импорт списка расходов)"
              // The quick-add calculator expands into this spot — step aside while it is open.
              className={`fixed bottom-[160px] right-5 w-[52px] h-[52px] bg-surface border border-separator/40 text-primary-text rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-all z-20 ${
                quickCalcOpen ? 'opacity-0 pointer-events-none' : ''
              }`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
          )}
          <ExpenseQuickAddBar expenses={expensesForQuickAdd} onCalcOpenChange={setQuickCalcOpen} />
        </>
      )}

      {groupPickerOpen && (
        <GroupPickerModal
          subject={pluralizeExpenses(selectedIds.size)}
          onClose={() => setGroupPickerOpen(false)}
          onPick={handleAssignGroup}
        />
      )}

      {scanning && <ScanReceiptFlow onClose={() => setScanning(false)} />}
      {bulkOpen && <BulkExpenseUploadFlow onClose={() => setBulkOpen(false)} />}

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
