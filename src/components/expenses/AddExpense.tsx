import { useState } from 'react'
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
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { Input } from '../shared/Input'
import { FileUpload, type AttachmentFile } from './FileUpload'
import { ReceiptItemsManager, type ReceiptItem } from './ReceiptItemsManager'

export function AddExpense() {
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

  const [name, setName] = useState('')
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategoryDocument | null>(null)
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([])
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState('')

  // Validation: at least name OR store required, and amount > 0
  const canSubmit = (name.trim() || selectedStore) && amount && parseFloat(amount) > 0

  const handleCreateStore = async (data: { name: string; type?: 'market' | 'store'; address?: string }) => {
    if (!storesCol) return
    // Dedup: find existing store with same name (case-insensitive) and same address
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) {
      setSelectedStore(existing)
      return
    }
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
    setSelectedStore(store)
  }

  const handleCreateCategory = async (categoryName: string) => {
    if (!categoriesCol) return
    const now = new Date().toISOString()
    const category: ExpenseCategoryDocument = {
      id: crypto.randomUUID(),
      name: categoryName,
      createdAt: now,
      updatedAt: now,
    }
    await categoriesCol.insert(category)
    setSelectedCategory(category)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !expensesCol) return

    // Validate
    if (!name.trim() && !selectedStore) {
      setValidationError('Укажите название или магазин')
      return
    }

    setSaving(true)
    setValidationError('')
    try {
      const now = new Date().toISOString()
      const expenseId = crypto.randomUUID()

      // 1. Insert expense
      await expensesCol.insert({
        id: expenseId,
        name: name.trim() || undefined,
        storeId: selectedStore?.id,
        amount: parseFloat(parseFloat(amount).toFixed(2)),
        date: new Date(date).toISOString(),
        categoryId: selectedCategory?.id,
        createdAt: now,
        updatedAt: now,
      })

      // 2. Lazy create receipt if needed (has attachments or items)
      const needsReceipt = attachments.length > 0 || receiptItems.length > 0
      if (needsReceipt && receiptsCol) {
        const receiptId = crypto.randomUUID()

        // Create receipt
        await receiptsCol.insert({
          id: receiptId,
          expenseId,
          createdAt: now,
          updatedAt: now,
        })

        // 3. Insert attachments
        if (attachments.length > 0 && attachmentsCol) {
          for (const attachment of attachments) {
            await attachmentsCol.insert({
              id: attachment.id,
              receiptId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              dataUrl: attachment.dataUrl,
              size: attachment.size,
              createdAt: now,
              updatedAt: now,
            })
          }
        }

        // 4. Insert receipt items
        if (receiptItems.length > 0 && receiptItemsCol) {
          for (const item of receiptItems) {
            await receiptItemsCol.insert({
              id: item.id,
              receiptId,
              name: item.name,
              amount: item.amount,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
      }

      navigate('/expenses')
    } catch (err) {
      console.error('Failed to save expense:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Новый расход</h2>
        <button
          onClick={() => navigate('/expenses')}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Отмена
        </button>
      </div>

      {/* Expense name */}
      <ExpenseNameAutocomplete expenses={expenses} value={name} onChange={setName} />

      {/* Store selector */}
      <StoreSelect stores={stores} selected={selectedStore} onSelect={setSelectedStore} onCreate={handleCreateStore} />

      {/* Amount & Date row */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Сумма (BYN)"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          placeholder="45.50"
        />
        <Input label="Дата" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      </div>

      {/* Category selector */}
      <ExpenseCategorySelect
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
        onCreate={handleCreateCategory}
      />

      {/* File upload */}
      <FileUpload attachments={attachments} onChange={setAttachments} />

      {/* Receipt items */}
      <ReceiptItemsManager items={receiptItems} onChange={setReceiptItems} />

      {/* Validation error */}
      {validationError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-[13px] text-destructive">
          {validationError}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || saving}
        className="w-full bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[17px] disabled:opacity-30 active:opacity-80 transition-opacity mt-2"
      >
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  )
}
