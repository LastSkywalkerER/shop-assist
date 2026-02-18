import { useState } from 'react'
import { Rating } from '../shared/Rating'
import type { PurchaseDocument, ProductDocument, StoreDocument } from '../../db/types'
import type { RxCollection } from 'rxdb'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import { ProductSelect } from './ProductSelect'
import { StoreSelect } from './StoreSelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { DEFAULT_CURRENCY } from '../../config/currencies'

interface EditPurchaseProps {
  purchase: PurchaseDocument
  collection: RxCollection<PurchaseDocument>
  onDone: () => void
}

export function EditPurchase({ purchase, collection, onDone }: EditPurchaseProps) {
  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const products = useRxQuery(productsCol)
  const stores = useRxQuery(storesCol)

  const [selectedProduct, setSelectedProduct] = useState<ProductDocument | null>(
    products.find((p) => p.id === purchase.productId) ?? null,
  )
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(
    stores.find((s) => s.id === purchase.storeId) ?? null,
  )
  const [price, setPrice] = useState(purchase.price.toString())
  const [currency, setCurrency] = useState(purchase.currency || DEFAULT_CURRENCY)
  const [date, setDate] = useState(purchase.purchaseDate.split('T')[0])
  const [manufacturer, setManufacturer] = useState(purchase.manufacturer ?? '')
  const [packageVolume, setPackageVolume] = useState(purchase.packageVolume ?? '')
  const [variety, setVariety] = useState(purchase.variety ?? '')
  const [rating, setRating] = useState<number | undefined>(purchase.qualityRating)
  const [notes, setNotes] = useState(purchase.notes ?? '')
  const [saving, setSaving] = useState(false)

  // Sync product/store selection when data loads
  const resolvedProduct = selectedProduct ?? products.find((p) => p.id === purchase.productId) ?? null
  const resolvedStore = selectedStore ?? stores.find((s) => s.id === purchase.storeId) ?? null

  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean) as string[])).sort()

  const handleCreateProduct = async (data: { name: string; category?: string }) => {
    if (!productsCol) return
    const now = new Date().toISOString()
    const product: ProductDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      category: data.category,
      createdAt: now,
      updatedAt: now,
    }
    await productsCol.insert(product)
    setSelectedProduct(product)
  }

  const handleCreateStore = async (data: { name: string; type?: 'market' | 'store'; address?: string }) => {
    if (!storesCol) return
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

  const handleSave = async () => {
    if (!resolvedProduct || !resolvedStore) return
    setSaving(true)
    try {
      const doc = await collection.findOne(purchase.id).exec()
      if (doc) {
        await doc.patch({
          productId: resolvedProduct.id,
          storeId: resolvedStore.id,
          price: parseFloat(parseFloat(price).toFixed(2)),
          currency,
          purchaseDate: new Date(date).toISOString(),
          manufacturer: manufacturer.trim() || undefined,
          packageVolume: packageVolume.trim() || undefined,
          variety: variety.trim() || undefined,
          qualityRating: rating || undefined,
          notes: notes.trim() || undefined,
          updatedAt: new Date().toISOString(),
        })
      }
      onDone()
    } catch (err) {
      console.error('Failed to update purchase:', err)
    } finally {
      setSaving(false)
    }
  }

  const canSave = !!resolvedProduct && !!resolvedStore && !!price && parseFloat(price) > 0

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      <div className="text-[13px] text-section-header font-medium pl-1">
        Редактирование покупки
      </div>

      {/* Product */}
      <ProductSelect
        products={products}
        categories={categories}
        selected={resolvedProduct}
        onSelect={setSelectedProduct}
        onCreate={handleCreateProduct}
      />

      {/* Store */}
      <StoreSelect
        stores={stores}
        selected={resolvedStore}
        onSelect={setSelectedStore}
        onCreate={handleCreateStore}
      />

      {/* Price & Date */}
      <div className="grid grid-cols-2 gap-3">
        <CurrencyAmountInput
          label="Цена"
          amount={price}
          currency={currency}
          onAmountChange={setPrice}
          onCurrencyChange={setCurrency}
          placeholder="3.49"
          required
        />
        <Input
          label="Дата"
          type="date"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
      </div>

      {/* Manufacturer & Package Volume */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Производитель"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.currentTarget.value)}
          placeholder="Савушкин"
        />
        <Input
          label="Объём / вес"
          value={packageVolume}
          onChange={(e) => setPackageVolume(e.currentTarget.value)}
          placeholder="1л"
        />
      </div>

      {/* Variety */}
      <Input
        label="Разновидность"
        value={variety}
        onChange={(e) => setVariety(e.currentTarget.value)}
        placeholder="Классическое"
      />

      {/* Rating */}
      <div className="flex flex-col gap-2">
        <label className="text-[13px] text-section-header font-medium pl-1">Оценка качества</label>
        <div className="flex items-center justify-between">
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
          className="bg-bg-secondary rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button
          onClick={onDone}
          className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
