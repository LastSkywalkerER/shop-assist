import type { ExpenseCategoryDocument } from '../../db/types'
import type { AnalyticsPeriod } from '../../lib/analytics/aggregate'

interface AnalyticsConfigPanelProps {
  period: AnalyticsPeriod
  onPeriodChange: (period: AnalyticsPeriod) => void
  categories: ExpenseCategoryDocument[]
  selectedCategoryIds: Set<string>
  onToggleCategory: (id: string) => void
  onClearCategories: () => void
}

const MODES: Array<{ mode: AnalyticsPeriod['mode']; label: string }> = [
  { mode: 'all', label: 'Всё время' },
  { mode: 'month', label: 'Месяц' },
  { mode: 'range', label: 'Период' },
]

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayInput(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const inputClass =
  'bg-bg-secondary/40 rounded-xl px-3 py-2 text-[14px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow w-full'

export function AnalyticsConfigPanel({
  period,
  onPeriodChange,
  categories,
  selectedCategoryIds,
  onToggleCategory,
  onClearCategories,
}: AnalyticsConfigPanelProps) {
  const switchMode = (mode: AnalyticsPeriod['mode']) => {
    if (mode === period.mode) return
    if (mode === 'all') onPeriodChange({ mode: 'all' })
    else if (mode === 'month') onPeriodChange({ mode: 'month', month: currentMonth() })
    else onPeriodChange({ mode: 'range', from: `${currentMonth()}-01`, to: todayInput() })
  }

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      {/* Period mode switch */}
      <div className="flex gap-2">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => switchMode(mode)}
            className={`flex-1 px-3 py-1.5 rounded-full text-[13px] font-medium outline-none transition-colors ${
              period.mode === mode
                ? 'bg-primary text-on-primary'
                : 'bg-bg-secondary/40 text-text-hint active:opacity-70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {period.mode === 'month' && (
        <input
          type="month"
          value={period.month}
          onChange={(e) => onPeriodChange({ mode: 'month', month: e.currentTarget.value || currentMonth() })}
          className={inputClass}
          style={{ colorScheme: 'inherit' }}
        />
      )}

      {period.mode === 'range' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-hint mb-1 pl-1">С</label>
            <input
              type="date"
              value={period.from}
              onChange={(e) => onPeriodChange({ ...period, from: e.currentTarget.value })}
              className={inputClass}
              style={{ colorScheme: 'inherit' }}
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-hint mb-1 pl-1">По</label>
            <input
              type="date"
              value={period.to}
              onChange={(e) => onPeriodChange({ ...period, to: e.currentTarget.value })}
              className={inputClass}
              style={{ colorScheme: 'inherit' }}
            />
          </div>
        </div>
      )}

      {/* Category multi-select */}
      {categories.length > 0 && (
        <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClearCategories}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium outline-none transition-colors ${
                selectedCategoryIds.size === 0
                  ? 'bg-primary text-on-primary'
                  : 'bg-bg-secondary/40 text-text-hint active:opacity-70'
              }`}
            >
              Все
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => onToggleCategory(cat.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium outline-none transition-colors ${
                  selectedCategoryIds.has(cat.id)
                    ? 'bg-primary text-on-primary'
                    : 'bg-bg-secondary/40 text-text-hint active:opacity-70'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
