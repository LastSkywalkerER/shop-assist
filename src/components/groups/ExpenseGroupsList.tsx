import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection } from '../../db/hooks'
import type { ExpenseDocument } from '../../db/types'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useToast } from '../../contexts/ToastContext'
import { BASE_CURRENCY } from '../../lib/currency/convert'
import { useExpenseGroups } from '../../hooks/useExpenseGroups'
import { addGroupDraft, removeGroupDraft, renameGroupDraft } from '../../lib/expenses/groupDrafts'
import { pluralizeExpenses } from './pluralize'

/**
 * Management screen for expense groups: create, rename, delete, and drill into
 * a group to see (and edit) its expenses. Groups are an analytics dimension
 * independent from categories, stored as `expense.groupName`.
 */
export function ExpenseGroupsList() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showToast } = useToast()

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const { groups } = useExpenseGroups()

  const [newName, setNewName] = useState('')
  /** Group being renamed inline (native prompts are not allowed in this app). */
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [busy, setBusy] = useState(false)

  const createGroup = () => {
    const name = newName.trim()
    if (!name) return
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      showToast('Такая группа уже есть', 'info')
      return
    }
    addGroupDraft(name)
    setNewName('')
  }

  /** Renaming a group rewrites the name on every expense that carries it. */
  const saveRename = async (from: string) => {
    const to = editingValue.trim()
    if (!expensesCol || !to || to === from) {
      setEditingName(null)
      return
    }
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const docs = await expensesCol.find({ selector: { groupName: from } }).exec()
      for (const doc of docs) {
        await doc.patch({ groupName: to, updatedAt: now })
      }
      renameGroupDraft(from, to)
      setEditingName(null)
    } finally {
      setBusy(false)
    }
  }

  const deleteGroup = async (name: string, count: number) => {
    if (!expensesCol) return
    const ok = await confirm({
      title: `Удалить группу «${name}»?`,
      message:
        count > 0
          ? `Сами расходы останутся — ${pluralizeExpenses(count)} просто выйдут из группы.`
          : 'Расходов в этой группе нет.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    })
    if (!ok) return

    setBusy(true)
    try {
      const now = new Date().toISOString()
      const docs = await expensesCol.find({ selector: { groupName: name } }).exec()
      for (const doc of docs) {
        await doc.patch({ groupName: undefined, updatedAt: now })
      }
      removeGroupDraft(name)
      showToast(`Группа «${name}» удалена`, 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Группы расходов</h2>
        <button
          onClick={() => navigate(-1)}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      <div className="px-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createGroup()
            }}
            placeholder="Новая группа..."
            className="flex-1 min-w-0 bg-surface rounded-xl px-4 py-2.5 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
          />
          <button
            type="button"
            onClick={createGroup}
            disabled={!newName.trim()}
            className="shrink-0 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-[14px] font-semibold disabled:opacity-30 active:opacity-80 transition-opacity"
          >
            Создать
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint leading-snug">
            Группа — это произвольный набор расходов (поездка, ремонт, проект).
            Она не связана с категориями: в аналитике можно смотреть срез по
            группе, по категории или по их пересечению.
          </div>
        ) : (
          groups.map((group) => {
            if (editingName === group.name) {
              return (
                <div key={group.name} className="bg-surface rounded-2xl px-4 py-3 flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(group.name)
                      if (e.key === 'Escape') setEditingName(null)
                    }}
                    className="flex-1 min-w-0 bg-bg-secondary/50 rounded-xl px-3 py-2 text-[15px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveRename(group.name)}
                    className="shrink-0 px-3 py-2 bg-primary text-on-primary rounded-xl text-[13px] font-semibold disabled:opacity-40 active:opacity-80 transition-opacity"
                  >
                    ОК
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(null)}
                    className="shrink-0 px-2 text-[13px] text-text-hint active:opacity-60 transition-opacity"
                  >
                    Отмена
                  </button>
                </div>
              )
            }

            return (
              <div key={group.name} className="bg-surface rounded-2xl px-4 py-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/groups/${encodeURIComponent(group.name)}`)}
                  className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
                >
                  <div className="text-[15px] font-medium text-text truncate">{group.name}</div>
                  <div className="text-[12px] text-text-hint mt-0.5">
                    {group.draft
                      ? 'Пустая группа — добавьте расходы'
                      : `${pluralizeExpenses(group.count)} · ${group.total.toFixed(2)} ${BASE_CURRENCY}`}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(group.name)
                    setEditingValue(group.name)
                  }}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-text-hint active:bg-primary/10 transition-colors"
                  title="Переименовать"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteGroup(group.name, group.count)}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors disabled:opacity-40"
                  title="Удалить группу"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            )
          })
        )}

        {groups.some((g) => g.draft) && (
          <p className="text-[11px] text-text-hint px-1 leading-snug">
            Пустая группа хранится только на этом устройстве, пока в неё не
            добавлен первый расход — после этого её видят все участники комнаты.
          </p>
        )}
      </div>
    </div>
  )
}
