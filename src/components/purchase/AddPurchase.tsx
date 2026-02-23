import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument, PurchaseAttachmentDocument } from '../../db/types'
import { ProductSelect } from './ProductSelect'
import { StoreSelect } from './StoreSelect'
import { Input } from '../shared/Input'
import { Rating } from '../shared/Rating'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { DEFAULT_CURRENCY } from '../../config/currencies'

export function AddPurchase() {
  const navigate = useNavigate()

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')
  const purchaseAttachmentsCol = useRxCollection<PurchaseAttachmentDocument>('purchaseAttachments')

  const products = useRxQuery(productsCol)
  const stores = useRxQuery(storesCol)

  const [selectedProduct, setSelectedProduct] = useState<ProductDocument | null>(null)
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [manufacturer, setManufacturer] = useState('')
  const [packageVolume, setPackageVolume] = useState('')
  const [variety, setVariety] = useState('')
  const [rating, setRating] = useState<number | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const canSubmit = selectedProduct && selectedStore && price && parseFloat(price) > 0

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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !purchasesCol) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const purchaseId = crypto.randomUUID()
      await purchasesCol.insert({
        id: purchaseId,
        productId: selectedProduct.id,
        storeId: selectedStore.id,
        price: parseFloat(parseFloat(price).toFixed(2)),
        currency,
        manufacturer: manufacturer.trim() || undefined,
        packageVolume: packageVolume.trim() || undefined,
        variety: variety.trim() || undefined,
        qualityRating: rating || undefined,
        notes: notes.trim() || undefined,
        purchaseDate: new Date(date).toISOString(),
        createdAt: now,
        updatedAt: now,
      })
      if (imageDataUrl && purchaseAttachmentsCol) {
        await purchaseAttachmentsCol.insert({
          id: crypto.randomUUID(),
          purchaseId,
          dataUrl: imageDataUrl,
          createdAt: now,
          updatedAt: now,
        })
      }
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
        categories={categories}
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

      {/* Image */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Фото</label>
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        {imageDataUrl ? (
          <div className="relative">
            <img src={imageDataUrl} alt="Purchase" className="w-full rounded-xl object-cover max-h-48" />
            <button
              onClick={() => { setImageDataUrl(null); if (imageInputRef.current) imageInputRef.current.value = '' }}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white active:opacity-70"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => imageInputRef.current?.click()}
            className="bg-surface rounded-xl px-4 py-3 flex items-center gap-2 text-text-hint text-[14px] active:bg-bg-secondary transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            Добавить фото
          </button>
        )}
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
