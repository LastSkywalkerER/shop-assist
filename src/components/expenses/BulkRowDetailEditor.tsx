import { useState } from 'react'
import type { StoreDocument, ExpenseCategoryDocument, ExpenseDocument } from '../../db/types'
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { CreatorField } from '../shared/CreatorField'

/** Attributes shared across every parsed row with the same source name. */
export interface SharedOverride {
  customName?: string
  storeId?: string
  categoryId?: string
  notes?: string
  creatorName?: string
}

/** Per-row attributes (amount/date/currency stay specific to one parsed line). */
export interface RowOverride {
  amount?: string
  date?: string
  currency?: string
}

export interface BulkRowDetailInitial {
  name: string
  amount: string
  currency: string
  date: string
  storeId?: string
  categoryId?: string
  notes?: string
  creatorName?: string
}

interface BulkRowDetailEditorProps {
  /** Raw source name — shown so the user knows the name change propagates. */
  rawName: string
  siblingCount: number
  initial: BulkRowDetailInitial
  stores: StoreDocument[]
  categories: ExpenseCategoryDocument[]
  expenses: ExpenseDocument[]
  onCreateStore: (data: { name: string; address?: string }) => Promise<StoreDocument | undefined>
  onCreateCategory: (name: string) => Promise<ExpenseCategoryDocument | undefined>
  roomId: string | null
  onSave: (shared: SharedOverride, row: RowOverride) => void
  onClose: () => void
}

export function BulkRowDetailEditor({
  rawName,
  siblingCount,
  initial,
  stores,
  categories,
  expenses,
  onCreateStore,
  onCreateCategory,
  roomId,
  onSave,
  onClose,
}: BulkRowDetailEditorProps) {
  const [name, setName] = useState(initial.name)
  const [amount, setAmount] = useState(initial.amount)
  const [currency, setCurrency] = useState(initial.currency)
  const [date, setDate] = useState(initial.date)
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(
    () => stores.find((s) => s.id === initial.storeId) ?? null,
  )
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategoryDocument | null>(
    () => categories.find((c) => c.id === initial.categoryId) ?? null,
  )
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [creatorName, setCreatorName] = useState(initial.creatorName ?? '')

  const handleCreateStore = async (data: { name: string; address?: string }) => {
    const store = await onCreateStore(data)
    if (store) setSelectedStore(store)
    return store
  }

  const handleCreateCategory = async (categoryName: string) => {
    const cat = await onCreateCategory(categoryName)
    if (cat) setSelectedCategory(cat)
  }

  const handleSave = () => {
    onSave(
      {
        customName: name.trim() || undefined,
        storeId: selectedStore?.id,
        categoryId: selectedCategory?.id,
        notes: notes.trim() || undefined,
        creatorName: creatorName.trim() || undefined,
      },
      { amount, currency, date },
    )
  }

  const canSave = !!amount && parseFloat(amount) > 0

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg w-full sm:max-w-md max-h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-text">Детали расхода</h2>
            <button onClick={onClose} className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity">
              Закрыть
            </button>
          </div>

          {siblingCount > 1 && (
            <div className="bg-primary/10 border border-primary/20 rounded-2xl px-3 py-2.5 text-[12px] text-text-hint">
              Имя и общие поля применятся ко всем строкам с исходным названием «{rawName}» ({siblingCount} шт.). Сумма и дата — только для этой строки.
            </div>
          )}

          <ExpenseNameAutocomplete
            expenses={expenses}
            value={name}
            onChange={setName}
            onSelectSuggestion={(_, categoryId) => {
              if (categoryId) {
                const cat = categories.find((c) => c.id === categoryId)
                if (cat) setSelectedCategory(cat)
              }
            }}
          />

          <StoreSelect stores={stores} selected={selectedStore} onSelect={setSelectedStore} onCreate={handleCreateStore} />

          <div className="grid grid-cols-2 gap-3">
            <CurrencyAmountInput
              label="Сумма"
              amount={amount}
              currency={currency}
              onAmountChange={setAmount}
              onCurrencyChange={setCurrency}
              placeholder="45.50"
              required
            />
            <Input label="Дата" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
          </div>

          <ExpenseCategorySelect
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onCreate={handleCreateCategory}
          />

          <div>
            <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">Комментарий</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              placeholder="Дополнительная информация о расходе..."
              className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
              rows={2}
            />
          </div>

          <CreatorField value={creatorName} onChange={setCreatorName} roomId={roomId} />

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[17px] disabled:opacity-30 active:opacity-80 transition-opacity"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  )
}
