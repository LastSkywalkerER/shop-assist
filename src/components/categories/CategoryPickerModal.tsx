import { useMemo, useState } from 'react'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ExpenseCategoryDocument } from '../../db/types'

interface CategoryPickerModalProps {
  /** Shown in the title, e.g. «3 расхода». */
  subject: string
  onClose: () => void
  /** `null` means «убрать категорию». */
  onPick: (categoryId: string | null) => void | Promise<void>
}

/**
 * Category chooser for a bulk action: pick an existing category, create one on
 * the spot, or clear the category of the selected expenses. Mirrors
 * GroupPickerModal — categories are documents, groups are plain names.
 */
export function CategoryPickerModal({ subject, onClose, onPick }: CategoryPickerModalProps) {
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const { data: categories } = useRxQuery(categoriesCol)

  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  // Newest first; sorted in memory (createdAt is not indexed).
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [categories],
  )

  const pick = async (categoryId: string | null) => {
    if (busy) return
    setBusy(true)
    try {
      await onPick(categoryId)
    } finally {
      setBusy(false)
    }
  }

  const createAndPick = async () => {
    const name = newName.trim()
    if (!name || !categoriesCol || busy) return
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      await pick(existing.id)
      return
    }
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const category: ExpenseCategoryDocument = {
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
      }
      await categoriesCol.insert(category)
      await onPick(category.id)
    } finally {
      setBusy(false)
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
          <h3 className="text-[17px] font-bold text-text">{subject} — категория</h3>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createAndPick()
              }}
              placeholder="Новая категория..."
              className="flex-1 min-w-0 bg-surface rounded-xl px-4 py-2.5 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
            />
            <button
              type="button"
              onClick={() => void createAndPick()}
              disabled={!newName.trim() || busy}
              className="shrink-0 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-[14px] font-semibold disabled:opacity-30 active:opacity-80 transition-opacity"
            >
              Создать
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 min-h-0">
          {sortedCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              disabled={busy}
              onClick={() => void pick(category.id)}
              className="w-full bg-surface rounded-xl px-4 py-3 text-left text-[15px] text-text active:opacity-70 transition-opacity disabled:opacity-40"
            >
              {category.name}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void pick(null)}
            className="w-full bg-surface rounded-xl px-4 py-3 text-left text-[15px] text-text-hint active:opacity-70 transition-opacity disabled:opacity-40"
          >
            Без категории
          </button>
        </div>

        <div className="p-4 border-t border-separator/20">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 text-primary-text font-medium active:bg-primary/10 rounded-xl transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
