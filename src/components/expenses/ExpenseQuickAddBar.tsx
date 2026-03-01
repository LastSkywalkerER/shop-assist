import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection } from '../../db/hooks'
import type { ExpenseDocument } from '../../db/types'
import { CURRENCIES, DEFAULT_CURRENCY } from '../../config/currencies'

interface ExpenseQuickAddBarProps {
  onAdd?: () => void
}

export function ExpenseQuickAddBar({ onAdd }: ExpenseQuickAddBarProps) {
  const navigate = useNavigate()
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const inputRef = useRef<HTMLInputElement>(null)

  const canAdd = (name.trim() || amount.trim()) && parseFloat(amount) > 0

  const handleAdd = async () => {
    if (!canAdd || !expensesCol) return

    const parsedAmount = parseFloat(parseFloat(amount).toFixed(2))
    if (isNaN(parsedAmount) || parsedAmount <= 0) return

    const now = new Date().toISOString()
    const expenseId = crypto.randomUUID()

    try {
      await expensesCol.insert({
        id: expenseId,
        name: name.trim() || undefined,
        amount: parsedAmount,
        currency,
        date: new Date().toISOString(),
        createdAt: now,
        updatedAt: now,
      })
      setName('')
      setAmount('')
      inputRef.current?.focus()
      onAdd?.()
    } catch (err) {
      console.error('Failed to add expense:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-9 pointer-events-none">
      <div className="px-4 pb-[80px] pt-2 pointer-events-auto">
        <div className="glass rounded-2xl border border-separator/20 shadow-[0_4px_20px_rgba(0,0,0,0.1)] flex items-center gap-2 px-3 py-2 min-h-[48px]">
          <button
            type="button"
            onClick={() => navigate('/expenses/add')}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-text-hint hover:text-text active:opacity-70 transition-opacity shrink-0"
            title="Полная форма"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Название"
            className="flex-1 min-w-0 bg-transparent text-[15px] text-text placeholder:text-text-hint outline-none"
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0"
            className="w-16 bg-transparent text-[15px] text-text placeholder:text-text-hint outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="bg-transparent text-[13px] text-text-hint font-medium outline-none cursor-pointer appearance-none pr-1"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-on-primary active:opacity-70 transition-opacity disabled:opacity-40 shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
