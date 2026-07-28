import { useState } from 'react'
import type { StoreDocument, ExpenseCategoryDocument, ExpenseDocument } from '../../db/types'
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { CreatorField } from '../shared/CreatorField'

/** Manual overrides for a single parsed row. Every field applies to that row only. */
export interface RowOverride {
  customName?: string
  storeId?: string
  categoryId?: string
  notes?: string
  creatorName?: string
  amount?: string
  date?: string
  currency?: string
}

/** Fields that an opt-in bulk apply copies to sibling rows (amount/date/currency stay per row). */
export type SharedRowFields = Omit<RowOverride, 'amount' | 'date' | 'currency'>

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
  /** Raw source name — shown on the opt-in bulk apply toggle. */
  rawName: string
  siblingCount: number
  initial: BulkRowDetailInitial
  stores: StoreDocument[]
  categories: ExpenseCategoryDocument[]
  expenses: ExpenseDocument[]
  onCreateStore: (data: { name: string; address?: string }) => Promise<StoreDocument | undefined>
  onCreateCategory: (name: string) => Promise<ExpenseCategoryDocument | undefined>
  roomId: string | null
  onSave: (values: RowOverride, applyToSiblings: boolean) => void
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
  // Off by default: an edit touches only the row the user opened.
  const [applyToSiblings, setApplyToSiblings] = useState(false)

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
        amount,
        currency,
        date,
      },
      applyToSiblings,
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
            <button
              type="button"
              onClick={() => setApplyToSiblings((v) => !v)}
              className="w-full flex items-start gap-2.5 bg-bg-secondary/40 rounded-2xl px-3 py-2.5 text-left active:opacity-60 transition-opacity"
            >
              <span
                className={`mt-0.5 w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                  applyToSiblings ? 'bg-primary border-primary' : 'border-separator'
                }`}
              >
                {applyToSiblings && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="flex-1 min-w-0 text-[12px] text-text-hint">
                Применить название, магазин, категорию и комментарий ко всем строкам «{rawName}» ({siblingCount} шт.).
                Сумма и дата в любом случае меняются только у этой строки.
              </span>
            </button>
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
