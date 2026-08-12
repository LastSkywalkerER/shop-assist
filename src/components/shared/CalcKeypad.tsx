import type { CalcInputApi } from '../../hooks/useCalcInput'

/** Operator keys — the mobile decimal keyboard has none of these. */
const KEYS: Array<{ label: string; token: string; compact: boolean }> = [
  { label: '+', token: '+', compact: true },
  { label: '−', token: '-', compact: true },
  { label: '×', token: '*', compact: true },
  { label: '÷', token: '/', compact: true },
  { label: '%', token: '%', compact: false },
  { label: '(', token: '(', compact: false },
  { label: ')', token: ')', compact: false },
]

interface CalcKeypadProps {
  calc: CalcInputApi
  /** Drop the rarely used keys — for fields sitting in a narrow column. */
  compact?: boolean
  className?: string
}

/**
 * Operator strip for a `useCalcInput` field. Rendered only while the field is
 * focused; `onMouseDown` is suppressed so tapping a key keeps the caret (and
 * the on-screen keyboard) exactly where it was.
 */
export function CalcKeypad({ calc, compact = false, className = '' }: CalcKeypadProps) {
  if (!calc.focused) return null

  const keys = compact ? KEYS.filter((k) => k.compact) : KEYS

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className={`rounded-xl bg-bg-secondary/60 px-1.5 py-1.5 space-y-1 select-none ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] text-text-hint truncate">
          {calc.invalid
            ? 'Не удаётся посчитать'
            : calc.draft.trim() === '' && !compact
              ? 'Калькулятор — например 12+3×2'
              : 'Калькулятор'}
        </span>
        {calc.preview !== null && (
          <span className="text-[12px] font-semibold text-primary-text tabular-nums shrink-0">
            = {calc.preview}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {keys.map((key) => (
          <button
            key={key.token}
            type="button"
            tabIndex={-1}
            onClick={() => calc.insert(key.token)}
            className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-surface text-[15px] text-text font-medium active:bg-primary/10 transition-colors"
          >
            {key.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          onClick={calc.backspace}
          aria-label="Стереть"
          className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-surface text-[15px] text-text-hint active:bg-primary/10 transition-colors"
        >
          ⌫
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={calc.commit}
          aria-label="Посчитать"
          className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-primary text-on-primary text-[15px] font-semibold active:opacity-80 transition-opacity"
        >
          =
        </button>
      </div>
    </div>
  )
}
