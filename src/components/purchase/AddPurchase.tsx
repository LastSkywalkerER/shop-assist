import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument } from '../../db/types'
import { ProductSelect } from './ProductSelect'
import { StoreSelect } from './StoreSelect'
import { Input } from '../shared/Input'
import { Rating } from '../shared/Rating'

export function AddPurchase() {
  const navigate = useNavigate()

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const products = useRxQuery(productsCol)
  const stores = useRxQuery(storesCol)

  const [selectedProduct, setSelectedProduct] = useState<ProductDocument | null>(null)
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(null)
  const [price, setPrice] = useState('')
  const [rating, setRating] = useState<number | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)

  const canSubmit = selectedProduct && selectedStore && price && parseFloat(price) > 0

  const handleCreateProduct = async (data: { name: string; manufacturer?: string; packageVolume?: string; category?: string }) => {
    if (!productsCol) return
    const now = new Date().toISOString()
    const product: ProductDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      manufacturer: data.manufacturer,
      packageVolume: data.packageVolume,
      category: data.category,
      createdAt: now,
      updatedAt: now,
    }
    await productsCol.insert(product)
    setSelectedProduct(product)
  }

  const handleCreateStore = async (data: { name: string; type?: 'market' | 'store'; address?: string }) => {
    if (!storesCol) return
    // Dedup: find existing store with same name (case-insensitive) and same address
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) {
      setSelectedStore(existing)
      return
    }
    const now = new Date().toISOString()
    const store: StoreDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      type: data.type,
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
    setSelectedStore(store)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !purchasesCol) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      await purchasesCol.insert({
        id: crypto.randomUUID(),
        productId: selectedProduct.id,
        storeId: selectedStore.id,
        priceByn: parseFloat(parseFloat(price).toFixed(2)),
        qualityRating: rating || undefined,
        notes: notes.trim() || undefined,
        purchaseDate: new Date(date).toISOString(),
        createdAt: now,
        updatedAt: now,
      })
      navigate('/')
    } catch (err) {
      console.error('Failed to save purchase:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Новая покупка</h2>
        <button
          onClick={() => navigate('/')}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Отмена
        </button>
      </div>

      {/* Product selector */}
      <ProductSelect
        products={products}
        selected={selectedProduct}
        onSelect={setSelectedProduct}
        onCreate={handleCreateProduct}
      />

      {/* Store selector */}
      <StoreSelect
        stores={stores}
        selected={selectedStore}
        onSelect={setSelectedStore}
        onCreate={handleCreateStore}
      />

      {/* Price & Date row */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Цена (BYN)"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.currentTarget.value)}
          placeholder="3.49"
        />
        <Input
          label="Дата"
          type="date"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
      </div>

      {/* Quality rating */}
      <div className="flex flex-col gap-2">
        <label className="text-[13px] text-section-header font-medium pl-1">Оценка качества</label>
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between">
          <Rating value={rating} onChange={(v) => setRating(v === 0 ? undefined : v)} />
          {rating && (
            <span className="text-[13px] text-text-hint">{rating} из 5</span>
          )}
        </div>
      </div>

      {/* Comment */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Комментарий</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Заметка о покупке..."
          rows={2}
          className="bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || saving}
        className="w-full bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[17px] disabled:opacity-30 active:opacity-80 transition-opacity mt-2"
      >
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  )
}
