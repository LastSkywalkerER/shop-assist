import { useState } from 'react'
import type { RxCollection } from 'rxdb'
import type { ExpenseDocument, StoreDocument, ExpenseCategoryDocument } from '../../db/types'
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { Input } from '../shared/Input'

interface EditExpenseProps {
  expense: ExpenseDocument
  collection: RxCollection<ExpenseDocument>
  stores: StoreDocument[]
  categories: ExpenseCategoryDocument[]
  expenses: ExpenseDocument[]
  onDone: () => void
  onCreateStore: (data: { name: string; type?: 'market' | 'store'; address?: string }) => Promise<void>
  onCreateCategory: (name: string) => Promise<void>
}

export function EditExpense({
  expense,
  collection,
  stores,
  categories,
  expenses,
  onDone,
  onCreateStore,
  onCreateCategory,
}: EditExpenseProps) {
  const [name, setName] = useState(expense.name || '')
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(
    expense.storeId ? stores.find((s) => s.id === expense.storeId) || null : null
  )
  const [amount, setAmount] = useState(expense.amount.toString())
  const [date, setDate] = useState(expense.date.split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategoryDocument | null>(
    expense.categoryId ? categories.find((c) => c.id === expense.categoryId) || null : null
  )
  const [notes, setNotes] = useState(expense.notes || '')
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState('')

  const hasChanges =
    name.trim() !== (expense.name || '') ||
    selectedStore?.id !== expense.storeId ||
    parseFloat(amount) !== expense.amount ||
    new Date(date).toISOString() !== expense.date ||
    selectedCategory?.id !== expense.categoryId ||
    notes.trim() !== (expense.notes || '')

  const canSubmit = (name.trim() || selectedStore) && amount && parseFloat(amount) > 0 && hasChanges

  const handleSave = async () => {
    if (!canSubmit) return

    // Validate
    if (!name.trim() && !selectedStore) {
      setValidationError('Укажите название или магазин')
      return
    }

    setSaving(true)
    setValidationError('')
    try {
      const doc = await collection.findOne(expense.id).exec()
      if (doc) {
        await doc.patch({
          name: name.trim() || undefined,
          storeId: selectedStore?.id,
          amount: parseFloat(parseFloat(amount).toFixed(2)),
          date: new Date(date).toISOString(),
          categoryId: selectedCategory?.id,
          notes: notes.trim() || undefined,
          updatedAt: new Date().toISOString(),
        })
      }
      onDone()
    } catch (err) {
      console.error('Failed to update expense:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <ExpenseNameAutocomplete expenses={expenses} value={name} onChange={setName} />
      <StoreSelect stores={stores} selected={selectedStore} onSelect={setSelectedStore} onCreate={onCreateStore} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Сумма (BYN)"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
        />
        <Input label="Дата" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      </div>
      <ExpenseCategorySelect
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
        onCreate={onCreateCategory}
      />

      <div>
        <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
          Комментарий
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          placeholder="Дополнительная информация о расходе..."
          className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
          rows={2}
        />
      </div>

      {validationError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-[13px] text-destructive">
          {validationError}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!canSubmit || saving}
          className="flex-1 bg-primary text-on-primary py-3 rounded-xl font-semibold text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button onClick={onDone} className="px-5 text-primary-text font-medium active:bg-primary/10 rounded-xl transition-colors">
          Отмена
        </button>
      </div>
    </div>
  )
}
