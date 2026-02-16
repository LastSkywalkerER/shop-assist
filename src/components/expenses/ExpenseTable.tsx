import { ExpenseRow, type ExpenseRowData } from './ExpenseRow'

interface ExpenseTableProps {
  data: ExpenseRowData[]
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onLongPress?: (id: string) => void
}

export function ExpenseTable({ data, selectionMode, selectedIds, onToggleSelect, onLongPress }: ExpenseTableProps) {
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
    <div className="mx-4 mt-2 mb-20 flex flex-col gap-3">
      {data.map((row) => (
        <ExpenseRow
          key={row.expenseId}
          data={row}
          selectionMode={selectionMode}
          selected={selectedIds?.has(row.expenseId)}
          onToggleSelect={() => onToggleSelect?.(row.expenseId)}
          onLongPress={() => onLongPress?.(row.expenseId)}
        />
      ))}
    </div>
  )
}
