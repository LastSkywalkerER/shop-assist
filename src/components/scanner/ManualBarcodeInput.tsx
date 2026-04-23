import { useState } from 'react'
import { isValidBarcode } from '../../lib/barcode/detector'

interface ManualBarcodeInputProps {
  onSubmit: (barcode: string) => void
  onCancel: () => void
}

export function ManualBarcodeInput({ onSubmit, onCancel }: ManualBarcodeInputProps) {
  const [value, setValue] = useState('')
  const digits = value.replace(/\D/g, '')
  const valid = isValidBarcode(digits)

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3 w-full max-w-sm">
      <div className="text-[17px] font-semibold text-text">Ввести штрих-код</div>
      <div className="text-[13px] text-text-hint">8–14 цифр (EAN-8, UPC-A, EAN-13, GTIN-14).</div>
      <input
        type="text"
        inputMode="numeric"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) {
            e.preventDefault()
            onSubmit(digits)
          }
        }}
        placeholder="4810268032738"
        className="w-full bg-bg-secondary rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow tracking-wider"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
        <button
          onClick={() => onSubmit(digits)}
          disabled={!valid}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          Найти
        </button>
      </div>
    </div>
  )
}
