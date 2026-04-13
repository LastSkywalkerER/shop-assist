import { useMemo } from 'react'
import { GroupedVirtuoso } from 'react-virtuoso'
import { ExpenseRow, type ExpenseRowData } from './ExpenseRow'

interface ExpenseTableProps {
  data: ExpenseRowData[]
  loading?: boolean
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onLongPress?: (id: string) => void
  customScrollParent?: HTMLElement | null
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function groupByDate(rows: ExpenseRowData[]): { label: string; key: string; rows: ExpenseRowData[] }[] {
  const map = new Map<string, ExpenseRowData[]>()
  for (const row of rows) {
    const key = row.date.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, rows]) => ({ key, label: formatDateLabel(key), rows }))
}

function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl px-3.5 py-3 border border-separator/10 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-4 bg-text/10 rounded-full w-1/2" />
        <div className="h-4 bg-text/10 rounded-full w-16" />
      </div>
      <div className="h-3 bg-text/8 rounded-full w-1/3" />
    </div>
  )
}

export function ExpenseTable({ data, loading, selectionMode, selectedIds, onToggleSelect, onLongPress, customScrollParent }: ExpenseTableProps) {
  const groups = useMemo(() => groupByDate(data), [data])
  const groupCounts = useMemo(() => groups.map((g) => g.rows.length), [groups])
  const flatItems = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  if (loading) {
    return (
      <div className="mx-4 mt-2">
        {[3, 2].map((count, gi) => (
          <div key={gi}>
            <div className="px-1 pt-3 pb-1">
              <div className="h-3 bg-text/10 rounded-full w-36 animate-pulse" />
            </div>
            <div className="flex flex-col gap-3">
              {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-8 pb-20">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-80">💰</div>
          <div className="text-[17px] font-medium text-text mb-1">Пока пусто</div>
          <div className="text-[13px] text-text-hint leading-snug">
            Нажмите <span className="inline-flex items-center justify-center w-6 h-6 bg-primary text-on-primary rounded-full text-[14px] font-medium align-middle mx-0.5">+</span> чтобы<br />добавить первый расход
          </div>
        </div>
      </div>
    )
  }

  return (
    <GroupedVirtuoso
      customScrollParent={customScrollParent ?? undefined}
      defaultItemHeight={68}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      groupCounts={groupCounts}
      groupContent={(index) => (
        <div className="text-[12px] text-text-hint font-medium px-5 pt-3 pb-1 bg-bg-secondary">
          {groups[index].label}
        </div>
      )}
      itemContent={(index) => {
        const row = flatItems[index]
        return (
          <div className="mx-4 mb-3">
            <ExpenseRow
              data={row}
              selectionMode={selectionMode}
              selected={selectedIds?.has(row.expenseId)}
              onToggleSelect={() => onToggleSelect?.(row.expenseId)}
              onLongPress={() => onLongPress?.(row.expenseId)}
            />
          </div>
        )
      }}
    />
  )
}
