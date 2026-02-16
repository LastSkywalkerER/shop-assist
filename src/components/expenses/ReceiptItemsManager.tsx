import { useState } from 'react'
import { Input } from '../shared/Input'
import { CategorySelect } from '../shared/CategorySelect'

export interface ReceiptItem {
  id: string
  name: string
  amount: number
  manufacturer?: string
  packageVolume?: string
  category?: string
  addToProducts?: boolean
}

interface ReceiptItemsManagerProps {
  items: ReceiptItem[]
  onChange: (items: ReceiptItem[]) => void
  productCategories: string[]
}

export function ReceiptItemsManager({ items, onChange, productCategories }: ReceiptItemsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)

  const handleAdd = (item: ReceiptItem) => {
    onChange([...items, item])
    setShowAddForm(false)
  }

  const handleUpdate = (id: string, updatedItem: ReceiptItem) => {
    onChange(items.map((item) => (item.id === id ? updatedItem : item)))
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
                <ReceiptItemForm
                  key={item.id}
                  item={item}
                  productCategories={productCategories}
                  onSave={(updatedItem) => handleUpdate(item.id, updatedItem)}
                  onCancel={() => setEditingId(null)}
                />
              )
            }

            const subtitle = [item.manufacturer, item.packageVolume, item.category].filter(Boolean).join(' · ')

            return (
              <div
                key={item.id}
                className="bg-surface rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setEditingId(item.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className="text-[14px] font-medium text-text truncate">
                      {item.name}
                    </div>
                    {item.addToProducts && (
                      <span className="text-[11px] px-1.5 py-0.5 bg-primary/10 text-primary-text rounded">
                        В продукты
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-text-hint mt-0.5">
                    {item.amount.toFixed(2)} BYN
                    {subtitle && ` · ${subtitle}`}
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
        <ReceiptItemForm
          productCategories={productCategories}
          onSave={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
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

interface ReceiptItemFormProps {
  item?: ReceiptItem
  productCategories: string[]
  onSave: (item: ReceiptItem) => void
  onCancel: () => void
}

function ReceiptItemForm({ item, productCategories, onSave, onCancel }: ReceiptItemFormProps) {
  const [name, setName] = useState(item?.name || '')
  const [amount, setAmount] = useState(item?.amount.toString() || '')
  const [manufacturer, setManufacturer] = useState(item?.manufacturer || '')
  const [packageVolume, setPackageVolume] = useState(item?.packageVolume || '')
  const [category, setCategory] = useState(item?.category || '')
  const [addToProducts, setAddToProducts] = useState(item?.addToProducts || false)

  const handleSubmit = () => {
    const trimmedName = name.trim()
    const parsedAmount = parseFloat(amount)

    if (!trimmedName || !parsedAmount || parsedAmount <= 0) return

    onSave({
      id: item?.id || crypto.randomUUID(),
      name: trimmedName,
      amount: parseFloat(parsedAmount.toFixed(2)),
      manufacturer: manufacturer.trim() || undefined,
      packageVolume: packageVolume.trim() || undefined,
      category: category.trim() || undefined,
      addToProducts,
    })
  }

  return (
    <div className="bg-surface rounded-2xl p-3 space-y-3">
      <div className="text-[13px] text-section-header font-medium">
        {item ? 'Редактирование позиции' : 'Новая позиция'}
      </div>

      {/* Name */}
      <Input
        label="Название"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Молоко"
        autoFocus
      />

      {/* Manufacturer */}
      <Input
        label="Производитель"
        value={manufacturer}
        onChange={(e) => setManufacturer(e.currentTarget.value)}
        placeholder="Савушкин"
      />

      {/* Package Volume & Category */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Объём"
          value={packageVolume}
          onChange={(e) => setPackageVolume(e.currentTarget.value)}
          placeholder="1л"
        />
        <CategorySelect
          categories={productCategories}
          value={category}
          onChange={setCategory}
          inputClassName="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
      </div>

      {/* Amount */}
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

      {/* Add to products checkbox */}
      <div className="flex items-center gap-3 px-1">
        <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setAddToProducts(!addToProducts)}>
          <div className="w-5 h-5 shrink-0 flex items-center justify-center">
            <div
              className={`w-4 h-4 rounded border-2 transition-all ${
                addToProducts ? 'bg-primary border-primary' : 'border-separator'
              }`}
            >
              {addToProducts && (
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
          <span className="text-[15px] text-text">Добавить в продукты</span>
        </label>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || !amount || parseFloat(amount) <= 0}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          {item ? 'Сохранить' : 'Добавить'}
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
