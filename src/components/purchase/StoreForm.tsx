import { useState } from 'react'
import { Input } from '../shared/Input'

interface StoreFormProps {
  onSave: (data: { name: string; type?: 'market' | 'store'; address?: string }) => void
  onCancel: () => void
}

export function StoreForm({ onSave, onCancel }: StoreFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'market' | 'store' | ''>('')
  const [address, setAddress] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      type: type || undefined,
      address: address.trim() || undefined,
    })
  }

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      <div className="text-[13px] text-section-header font-medium pl-1">
        Новый магазин
      </div>
      <Input label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Евроопт" />
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Тип</label>
        <div className="flex gap-2">
          {([['store', 'Магазин'], ['market', 'Рынок']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setType(type === val ? '' : val)}
              className={`flex-1 py-2.5 rounded-xl text-[15px] font-medium transition-all ${
                type === val
                  ? 'bg-primary text-on-primary'
                  : 'bg-bg-secondary text-text active:bg-separator/30'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Input label="Адрес" value={address} onChange={(e) => setAddress(e.currentTarget.value)} placeholder="ул. Примерная 1" />
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
