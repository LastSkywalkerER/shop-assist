import { CURRENCIES, DEFAULT_CURRENCY } from '../../config/currencies'
import { useCalcInput } from '../../hooks/useCalcInput'
import { CalcKeypad } from './CalcKeypad'

interface CurrencyAmountInputProps {
  label: string
  amount: string
  currency: string
  onAmountChange: (value: string) => void
  onCurrencyChange: (value: string) => void
  placeholder?: string
  required?: boolean
}

export function CurrencyAmountInput({
  label,
  amount,
  currency = DEFAULT_CURRENCY,
  onAmountChange,
  onCurrencyChange,
  placeholder = '0.00',
  required,
}: CurrencyAmountInputProps) {
  const inputId = label.toLowerCase().replace(/\s+/g, '-')
  // Accepts math as well as plain numbers: `12+3*2`, `100-15%`.
  const calc = useCalcInput({ value: amount, onChange: onAmountChange, decimals: 2, min: 0 })

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] text-section-header font-medium pl-1">
        {label}
      </label>
      <div className="flex bg-surface rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 transition-shadow">
        <input
          {...calc.inputProps}
          id={inputId}
          placeholder={placeholder}
          required={required}
          className="flex-1 min-w-0 bg-transparent px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 outline-none"
        />
        <select
          value={currency}
          onChange={e => onCurrencyChange(e.target.value)}
          className="bg-transparent text-[13px] text-text-hint font-medium pr-3 pl-1 py-3 outline-none cursor-pointer appearance-none"
        >
          {CURRENCIES.map(c => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>
      <CalcKeypad calc={calc} />
    </div>
  )
}
