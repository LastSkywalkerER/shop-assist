import { useCalcInput } from '../../hooks/useCalcInput'
import { CalcKeypad } from './CalcKeypad'

interface CalcInputProps {
  /** Committed numeric value (plain numeric string). */
  value: string
  onChange: (value: string) => void
  /** Decimals kept when a result is committed. Default 2. */
  decimals?: number
  min?: number
  max?: number
  onEnter?: () => void
  label?: string
  id?: string
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  'aria-label'?: string
  /** Drop the rarely used keypad keys — for fields in a narrow column. */
  compactKeypad?: boolean
  /** Classes for the `<input>` itself. */
  className?: string
  /** Classes for the wrapper around input + keypad. */
  wrapperClassName?: string
  keypadClassName?: string
}

/**
 * Numeric field that also accepts math: `12+3*2`, `(4+6)/2`, `100-15%`.
 * The operator strip appears while the field is focused — see `useCalcInput`.
 */
export function CalcInput({
  value,
  onChange,
  decimals,
  min,
  max,
  onEnter,
  label,
  id,
  placeholder,
  autoFocus,
  disabled,
  compactKeypad,
  className = '',
  wrapperClassName = '',
  keypadClassName = '',
  ...rest
}: CalcInputProps) {
  const calc = useCalcInput({ value, onChange, decimals, min, max, onEnter })
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] text-section-header font-medium pl-1">
          {label}
        </label>
      )}
      <input
        {...calc.inputProps}
        id={inputId}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={rest['aria-label']}
        className={className}
      />
      <CalcKeypad calc={calc} compact={compactKeypad} className={keypadClassName} />
    </div>
  )
}
