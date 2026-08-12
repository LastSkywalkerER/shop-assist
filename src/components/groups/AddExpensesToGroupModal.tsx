import { useMemo, useState } from 'react'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ExpenseDocument, StoreDocument } from '../../db/types'

interface AddExpensesToGroupModalProps {
  groupName: string
  onClose: () => void
  /** Called after the picked expenses have been moved into the group. */
  onAdded?: (count: number) => void
}

/** How many recent expenses the picker offers (the whole table is too much). */
const PICKER_LIMIT = 400

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Picker for adding existing expenses to a group: searchable, multi-select,
 * over the most recent expenses that are not in this group yet. Expenses that
 * belong to another group are shown too — picking one moves it here.
 */
export function AddExpensesToGroupModal({
  groupName,
  onClose,
  onAdded,
}: AddExpensesToGroupModalProps) {
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const { data: expenses } = useRxQuery(expensesCol, { sort: [{ date: 'desc' }], limit: PICKER_LIMIT })
  const { data: stores } = useRxQuery(storesCol)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const storeNames = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return expenses
      .filter((e) => e.groupName !== groupName)
      .filter((e) => {
        if (!q) return true
        const store = e.storeId ? storeNames.get(e.storeId) ?? '' : ''
        return `${e.name ?? ''} ${store}`.toLowerCase().includes(q)
      })
  }, [expenses, groupName, query, storeNames])

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    if (!expensesCol || picked.size === 0 || saving) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      for (const id of picked) {
        const doc = await expensesCol.findOne(id).exec()
        if (doc) await doc.patch({ groupName, updatedAt: now })
      }
      onAdded?.(picked.size)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-bg-secondary w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-[17px] font-bold text-text">Добавить в «{groupName}»</h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Поиск по названию или магазину"
            className="mt-3 w-full bg-surface rounded-xl px-4 py-2.5 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 min-h-0">
          {candidates.length === 0 ? (
            <div className="bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
              {query.trim() ? 'Ничего не найдено' : 'Все расходы уже в этой группе'}
            </div>
          ) : (
            candidates.map((expense) => {
              const checked = picked.has(expense.id)
              const store = expense.storeId ? storeNames.get(expense.storeId) : undefined
              return (
                <button
                  key={expense.id}
                  type="button"
                  onClick={() => toggle(expense.id)}
                  className={`w-full bg-surface rounded-xl px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors ${
                    checked ? 'ring-2 ring-primary/40' : ''
                  }`}
                >
                  <span
                    className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                      checked ? 'bg-primary border-primary text-on-primary' : 'border-separator/60'
                    }`}
                  >
                    {checked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] text-text truncate">
                      {expense.name || store || 'Расход'}
                    </span>
                    <span className="block text-[12px] text-text-hint mt-0.5">
                      {formatDate(expense.date)}
                      {expense.groupName ? ` · в группе «${expense.groupName}»` : ''}
                    </span>
                  </span>
                  <span className="text-[14px] font-semibold text-text tabular-nums shrink-0">
                    {expense.amount.toFixed(2)} {expense.currency}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="p-4 flex gap-2 border-t border-separator/20">
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={picked.size === 0 || saving}
            className="flex-1 bg-primary text-on-primary py-3 rounded-xl font-semibold text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
          >
            {saving ? 'Добавление...' : picked.size > 0 ? `Добавить (${picked.size})` : 'Добавить'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 text-primary-text font-medium active:bg-primary/10 rounded-xl transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
