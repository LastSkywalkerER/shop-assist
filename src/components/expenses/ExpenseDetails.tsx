import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
} from '../../db/types'
import { ConfirmModal } from '../shared/ConfirmModal'
import { EditExpense } from './EditExpense'
import { showBackButton } from '../../telegram/backButton'

export function ExpenseDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    return showBackButton(() => navigate('/expenses'))
  }, [navigate])

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

  const expense = useMemo(() => expenses.find((e) => e.id === id), [expenses, id])
  const receipt = useMemo(() => receipts.find((r) => r.expenseId === id), [receipts, id])
  const expenseReceiptItems = useMemo(() => (receipt ? receiptItems.filter((i) => i.receiptId === receipt.id) : []), [receipt, receiptItems])
  const expenseAttachments = useMemo(() => (receipt ? attachments.filter((a) => a.receiptId === receipt.id) : []), [receipt, attachments])

  const handleCreateStore = async (data: { name: string; type?: 'market' | 'store'; address?: string }) => {
    if (!storesCol) return
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) return
    const now = new Date().toISOString()
    const store: StoreDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      type: data.type,
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
  }

  const handleCreateCategory = async (categoryName: string) => {
    if (!categoriesCol) return
    const now = new Date().toISOString()
    const newCategory: ExpenseCategoryDocument = {
      id: crypto.randomUUID(),
      name: categoryName,
      createdAt: now,
      updatedAt: now,
    }
    await categoriesCol.insert(newCategory)
  }

  const handleDelete = async () => {
    if (!expensesCol || !expense) return
    setDeleting(true)
    try {
      // Delete receipt items
      if (receipt && receiptItemsCol) {
        for (const item of expenseReceiptItems) {
          const doc = await receiptItemsCol.findOne(item.id).exec()
          if (doc) await doc.remove()
        }
      }

      // Delete attachments
      if (receipt && attachmentsCol) {
        for (const att of expenseAttachments) {
          const doc = await attachmentsCol.findOne(att.id).exec()
          if (doc) await doc.remove()
        }
      }

      // Delete receipt
      if (receipt && receiptsCol) {
        const receiptDoc = await receiptsCol.findOne(receipt.id).exec()
        if (receiptDoc) await receiptDoc.remove()
      }

      // Delete expense
      const expenseDoc = await expensesCol.findOne(expense.id).exec()
      if (expenseDoc) await expenseDoc.remove()

      navigate('/expenses')
    } catch (err) {
      console.error('Failed to delete expense:', err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!expense) {
    return <div className="p-4 text-text-hint text-[15px]">Расход не найден</div>
  }

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Редактирование</h2>
      </div>

      {/* Edit form */}
      {expensesCol && (
        <div className="px-4">
          <EditExpense
            expense={expense}
            collection={expensesCol}
            stores={stores}
            categories={categories}
            expenses={expenses}
            onDone={() => navigate('/expenses')}
            onCreateStore={handleCreateStore}
            onCreateCategory={handleCreateCategory}
          />
        </div>
      )}

      {/* Receipt info */}
      {(expenseReceiptItems.length > 0 || expenseAttachments.length > 0) && (
        <div className="mx-4 mt-2 bg-surface rounded-2xl p-3">
          <div className="text-[13px] font-medium text-section-header mb-2">Чек</div>
          {expenseAttachments.length > 0 && (
            <div className="mb-2">
              <span className="text-[13px] text-text-hint">📎 {expenseAttachments.length} вложений</span>
            </div>
          )}
          {expenseReceiptItems.length > 0 && (
            <div>
              <span className="text-[13px] text-text-hint">{expenseReceiptItems.length} позиций чека</span>
            </div>
          )}
        </div>
      )}

      {/* Delete button */}
      <div className="mx-4 mt-4">
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full py-3 text-destructive text-[15px] font-medium bg-surface rounded-2xl active:bg-bg-secondary/50 transition-colors"
        >
          Удалить расход
        </button>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <ConfirmModal
          title="Удалить расход?"
          message={`Расход будет удалён без возможности восстановления${receipt ? ', включая все вложения и позиции чека' : ''}.`}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          destructive
          confirmDisabled={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
