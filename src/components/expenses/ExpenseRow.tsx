import { useNavigate } from 'react-router-dom'

export interface ExpenseRowData {
  expenseId: string
  name?: string
  storeName?: string
  amount: number
  currency?: string
  date: string
  categoryName?: string
  hasAttachments: boolean
  receiptItemsCount: number
}

interface ExpenseRowProps {
  data: ExpenseRowData
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onLongPress?: () => void
}

export function ExpenseRow({ data, selectionMode, selected, onToggleSelect, onLongPress }: ExpenseRowProps) {
  const navigate = useNavigate()

  // Title: name + storeName, or whichever exists
  const title = [data.name, data.storeName].filter(Boolean).join(' — ') || 'Расход'

  // Format date as DD.MM.YYYY
  const formattedDate = new Date(data.date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  // Long press detection (touch and mouse)
  let pressTimer: NodeJS.Timeout | null = null

  const handlePressStart = () => {
    if (!selectionMode && onLongPress) {
      pressTimer = setTimeout(() => {
        onLongPress()
      }, 500) // 500ms for long press
    }
  }

  const handlePressEnd = () => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  const handleClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect()
    } else {
      navigate(`/expenses/${data.expenseId}`)
    }
  }

  return (
    <div
      className={`bg-surface rounded-2xl px-3.5 py-2.5 active:bg-bg-secondary/50 transition-colors cursor-pointer ${
        selected ? 'ring-2 ring-primary' : ''
      }`}
      onClick={handleClick}
      onTouchStart={handlePressStart}
      onTouchEnd={handlePressEnd}
      onTouchCancel={handlePressEnd}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
    >
      {/* Top line: title + amount */}
      <div className="flex items-center justify-between gap-2">
        {selectionMode && (
          <div className="w-5 h-5 shrink-0 flex items-center justify-center">
            <div
              className={`w-4 h-4 rounded border-2 transition-all ${
                selected ? 'bg-primary border-primary' : 'border-separator'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect?.()
              }}
            >
              {selected && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-full h-full"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-medium text-text leading-tight">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[13px] text-primary-text font-semibold tabular-nums whitespace-nowrap">
            {data.amount.toFixed(2)} {data.currency || 'BYN'}
          </span>
          <svg className="text-text-hint/40" width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l4 4-4 4" />
          </svg>
        </div>
      </div>

      {/* Bottom line: date + category + indicators */}
      <div className="mt-1 flex items-center gap-2 text-[12px] text-text-hint">
        <span>{formattedDate}</span>
        {data.categoryName && (
          <>
            <span>·</span>
            <span className="px-2 py-0.5 bg-primary/10 text-primary-text rounded-full text-[11px]">
              {data.categoryName}
            </span>
          </>
        )}
        {data.hasAttachments && (
          <>
            <span>·</span>
            <span title="Есть вложения">📎</span>
          </>
        )}
        {data.receiptItemsCount > 0 && (
          <>
            <span>·</span>
            <span title="Позиции чека">{data.receiptItemsCount} поз.</span>
          </>
        )}
      </div>
    </div>
  )
}
