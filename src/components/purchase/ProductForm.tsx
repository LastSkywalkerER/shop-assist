import { useState } from 'react'
import { Input } from '../shared/Input'
import { CategorySelect } from '../shared/CategorySelect'

interface ProductFormProps {
  categories: string[]
  onSave: (data: { name: string; category?: string }) => void
  onCancel: () => void
}

export function ProductForm({ categories, onSave, onCancel }: ProductFormProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      category: category.trim() || undefined,
    })
  }

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      <div className="text-[13px] text-section-header font-medium pl-1">
        Новый продукт
      </div>
      <Input label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Молоко" />
      <CategorySelect
        categories={categories}
        value={category}
        onChange={setCategory}
        inputClassName="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          Создать
        </button>
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
