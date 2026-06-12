import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { SplitGroupDocument, ExpenseDocument } from '../../db/types'

function pluralizeExpenses(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return `${n} расходов`
  if (mod10 === 1) return `${n} расход`
  if (mod10 >= 2 && mod10 <= 4) return `${n} расхода`
  return `${n} расходов`
}

/** Entry point for the who-owes-whom math: pick a split group to settle. */
export function SplitGroupsList() {
  const navigate = useNavigate()

  const groupsCol = useRxCollection<SplitGroupDocument>('splitGroups')
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const { data: groups } = useRxQuery(groupsCol)
  const { data: expenses } = useRxQuery(expensesCol)

  // Newest groups first; sorted in memory (createdAt is not indexed).
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [groups],
  )

  const expenseCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of expenses) {
      if (e.splitGroupId) counts.set(e.splitGroupId, (counts.get(e.splitGroupId) ?? 0) + 1)
    }
    return counts
  }, [expenses])

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Кто кому должен</h2>
        <button
          onClick={() => navigate(-1)}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      {sortedGroups.length === 0 ? (
        <div className="mx-4 mt-2 bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
          Групп разделения пока нет. Группа задаётся в форме расхода — рядом с
          блоком «Разделить расход».
        </div>
      ) : (
        <div className="px-4 mt-2 space-y-2">
          {sortedGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => navigate(`/expenses/settlement/${group.id}`)}
              className="w-full bg-surface rounded-2xl px-4 py-3 flex items-center gap-3 active:bg-bg-secondary/50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-text truncate">{group.name}</div>
                <div className="text-[12px] text-text-hint mt-0.5">
                  {pluralizeExpenses(expenseCounts.get(group.id) ?? 0)}
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-hint shrink-0">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
