import { useState, useRef, useEffect } from 'react'
import { Rating } from '../shared/Rating'
import type { PurchaseDocument, ProductDocument, StoreDocument, PurchaseAttachmentDocument } from '../../db/types'
import type { RxCollection } from 'rxdb'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import { ProductSelect } from './ProductSelect'
import { StoreSelect } from './StoreSelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { UrlInput, type UrlMeta } from './UrlInput'
import { parseLinkMeta, serializeLinkMeta } from '../../lib/linkMeta'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import { blobStoreGet, blobStorePut, blobStoreRemove, addPendingUpload } from '../../db/blobStore'

interface EditPurchaseProps {
  purchase: PurchaseDocument
  collection: RxCollection<PurchaseDocument>
  onDone: () => void
}

export function EditPurchase({ purchase, collection, onDone }: EditPurchaseProps) {
  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchaseAttachmentsCol = useRxCollection<PurchaseAttachmentDocument>('purchaseAttachments')
  const { data: products } = useRxQuery(productsCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: allAttachments } = useRxQuery(purchaseAttachmentsCol)
  const existingAttachment = allAttachments.find((a) => a.purchaseId === purchase.id) ?? null

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
  const [urlMeta, setUrlMeta] = useState<UrlMeta | null>(() => {
    const m = parseLinkMeta(purchase.link)
    return m ? { url: m.url, title: m.title, description: m.description, image: m.image, favicon: m.favicon } : null
  })
  const [newImageAttachment, setNewImageAttachment] = useState<{
    id: string; objectUrl: string; fileName: string; mimeType: string; size: number
  } | null | undefined>(undefined)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!existingAttachment) return
    let url: string | null = null
    let cancelled = false
    blobStoreGet(existingAttachment.id).then(blob => {
      if (cancelled || !blob) return
      url = URL.createObjectURL(blob)
      setExistingImageUrl(url)
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [existingAttachment?.id])

  const displayedImage = newImageAttachment !== undefined
    ? (newImageAttachment?.objectUrl ?? null)
    : existingImageUrl

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

  const handleCreateStore = async (data: { name: string; address?: string }): Promise<StoreDocument | undefined> => {
    if (!storesCol) return undefined
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) {
      setSelectedStore(existing)
      return existing
    }
    const now = new Date().toISOString()
    const store: StoreDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
    setSelectedStore(store)
    return store
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const id = crypto.randomUUID()
    await blobStorePut(id, file)
    setNewImageAttachment({
      id,
      objectUrl: URL.createObjectURL(file),
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      size: file.size,
    })
  }

  const handleSave = async () => {
    if (!resolvedProduct || !resolvedStore) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
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
          link: urlMeta ? serializeLinkMeta({ url: urlMeta.url, title: urlMeta.title, description: urlMeta.description, image: urlMeta.image, favicon: urlMeta.favicon }) : undefined,
          updatedAt: now,
        })
      }
      if (purchaseAttachmentsCol && newImageAttachment !== undefined) {
        if (existingAttachment) {
          const existingDoc = await purchaseAttachmentsCol.findOne(existingAttachment.id).exec()
          if (existingDoc) await existingDoc.remove()
          blobStoreRemove(existingAttachment.id).catch(() => {})
        }
        if (newImageAttachment !== null) {
          addPendingUpload(newImageAttachment.id)
          await purchaseAttachmentsCol.insert({
            id: newImageAttachment.id,
            purchaseId: purchase.id,
            fileName: newImageAttachment.fileName,
            mimeType: newImageAttachment.mimeType,
            size: newImageAttachment.size,
            createdAt: now,
            updatedAt: now,
          })
        }
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
        Редактирование записи цены
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

      {/* Source URL */}
      <UrlInput value={urlMeta} onChange={setUrlMeta} />

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

      {/* Image */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Фото</label>
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        {displayedImage ? (
          <div className="relative">
            <img src={displayedImage} alt="Purchase" className="w-full rounded-xl object-cover max-h-48" />
            <button
              onClick={() => {
                if (newImageAttachment) {
                  URL.revokeObjectURL(newImageAttachment.objectUrl)
                  blobStoreRemove(newImageAttachment.id).catch(() => {})
                }
                setNewImageAttachment(null)
                if (imageInputRef.current) imageInputRef.current.value = ''
              }}
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
            className="bg-bg-secondary rounded-xl px-4 py-3 flex items-center gap-2 text-text-hint text-[14px] active:opacity-70 transition-opacity"
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
