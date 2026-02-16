import { useState } from 'react'
import { Input } from '../shared/Input'

export interface ReceiptItem {
  id: string
  name: string
  amount: number
}

interface ReceiptItemsManagerProps {
  items: ReceiptItem[]
  onChange: (items: ReceiptItem[]) => void
}

export function ReceiptItemsManager({ items, onChange }: ReceiptItemsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [newItemAmount, setNewItemAmount] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)

  const handleAdd = () => {
    const name = newItemName.trim()
    const amount = parseFloat(newItemAmount)

    if (!name || !amount || amount <= 0) return

    const newItem: ReceiptItem = {
      id: crypto.randomUUID(),
      name,
      amount: parseFloat(amount.toFixed(2)),
    }

    onChange([...items, newItem])
    setNewItemName('')
    setNewItemAmount('')
    setShowAddForm(false)
  }

  const handleUpdate = (id: string, name: string, amount: number) => {
    onChange(
      items.map((item) =>
        item.id === id
          ? { ...item, name: name.trim(), amount: parseFloat(amount.toFixed(2)) }
          : item
      )
    )
    setEditingId(null)
  }

  const handleRemove = (id: string) => {
    onChange(items.filter((item) => item.id !== id))
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-[13px] text-section-header font-medium pl-1">
          Позиции чека
        </label>
        {items.length > 0 && (
          <span className="text-[13px] text-text-hint">
            Итого: {totalAmount.toFixed(2)} BYN
          </span>
        )}
      </div>

      {/* Items list */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => {
            if (editingId === item.id) {
              return (
                <ReceiptItemEditCard
                  key={item.id}
                  item={item}
                  onSave={(name, amount) => handleUpdate(item.id, name, amount)}
                  onCancel={() => setEditingId(null)}
                />
              )
            }

            return (
              <div
                key={item.id}
                className="bg-surface rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setEditingId(item.id)}
                >
                  <div className="text-[14px] font-medium text-text truncate">
                    {item.name}
                  </div>
                  <div className="text-[12px] text-text-hint mt-0.5">
                    {item.amount.toFixed(2)} BYN
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                  title="Удалить"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-destructive"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {showAddForm ? (
        <div className="bg-surface rounded-2xl p-3 space-y-3">
          <div className="text-[13px] text-section-header font-medium">
            Новая позиция
          </div>
          <Input
            label="Название"
            value={newItemName}
            onChange={(e) => setNewItemName(e.currentTarget.value)}
            placeholder="Молоко"
            autoFocus
          />
          <Input
            label="Сумма (BYN)"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={newItemAmount}
            onChange={(e) => setNewItemAmount(e.currentTarget.value)}
            placeholder="3.50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newItemName.trim() || !newItemAmount || parseFloat(newItemAmount) <= 0}
              className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
            >
              Добавить
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false)
                setNewItemName('')
                setNewItemAmount('')
              }}
              className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="w-full py-3 bg-surface text-text text-[15px] font-medium rounded-2xl active:bg-bg-secondary/50 transition-colors flex items-center justify-center gap-2"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Добавить позицию
        </button>
      )}
    </div>
  )
}

interface ReceiptItemEditCardProps {
  item: ReceiptItem
  onSave: (name: string, amount: number) => void
  onCancel: () => void
}

function ReceiptItemEditCard({ item, onSave, onCancel }: ReceiptItemEditCardProps) {
  const [name, setName] = useState(item.name)
  const [amount, setAmount] = useState(item.amount.toString())

  const handleSave = () => {
    const trimmedName = name.trim()
    const parsedAmount = parseFloat(amount)

    if (!trimmedName || !parsedAmount || parsedAmount <= 0) return

    onSave(trimmedName, parsedAmount)
  }

  return (
    <div className="bg-surface rounded-2xl p-3 space-y-3">
      <div className="text-[13px] text-section-header font-medium">
        Редактирование
      </div>
      <Input
        label="Название"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Молоко"
        autoFocus
      />
      <Input
        label="Сумма (BYN)"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        placeholder="3.50"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim() || !amount || parseFloat(amount) <= 0}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
