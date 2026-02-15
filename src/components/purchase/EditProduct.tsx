import { useState } from 'react'
import type { ProductDocument } from '../../db/types'
import type { RxCollection } from 'rxdb'
import { CategorySelect } from '../shared/CategorySelect'

interface EditProductProps {
  product: ProductDocument
  collection: RxCollection<ProductDocument>
  categories: string[]
  onDone: () => void
}

export function EditProduct({ product, collection, categories, onDone }: EditProductProps) {
  const [name, setName] = useState(product.name)
  const [manufacturer, setManufacturer] = useState(product.manufacturer ?? '')
  const [packageVolume, setPackageVolume] = useState(product.packageVolume ?? '')
  const [category, setCategory] = useState(product.category ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const doc = await collection.findOne(product.id).exec()
      if (doc) {
        await doc.patch({
          name: name.trim(),
          manufacturer: manufacturer.trim() || undefined,
          packageVolume: packageVolume.trim() || undefined,
          category: category.trim() || undefined,
          updatedAt: new Date().toISOString(),
        })
      }
      onDone()
    } catch (err) {
      console.error('Failed to update product:', err)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    name.trim() !== product.name ||
    (manufacturer.trim() || '') !== (product.manufacturer ?? '') ||
    (packageVolume.trim() || '') !== (product.packageVolume ?? '') ||
    (category.trim() || '') !== (product.category ?? '')

  return (
    <div className="bg-surface rounded-2xl p-3 space-y-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Название"
        className="w-full bg-bg-secondary rounded-xl px-3 py-2 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />
      <input
        value={manufacturer}
        onChange={(e) => setManufacturer(e.target.value)}
        placeholder="Производитель"
        className="w-full bg-bg-secondary rounded-xl px-3 py-2 text-[14px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={packageVolume}
          onChange={(e) => setPackageVolume(e.target.value)}
          placeholder="Объём"
          className="bg-bg-secondary rounded-xl px-3 py-2 text-[14px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
        <CategorySelect
          categories={categories}
          value={category}
          onChange={setCategory}
          label=""
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !hasChanges || saving}
          className="flex-1 bg-primary text-on-primary py-2 rounded-xl font-medium text-[14px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button
          onClick={onDone}
          className="px-4 py-2 text-primary-text text-[14px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
