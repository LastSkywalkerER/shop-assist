import { useState, useMemo, useRef, useEffect } from 'react'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import { CategorySelect } from '../shared/CategorySelect'
import type { ProductDocument, PurchaseDocument, StoreDocument } from '../../db/types'

export interface ReceiptItem {
  id: string
  name: string
  amount: number
  currency?: string
  manufacturer?: string
  packageVolume?: string
  variety?: string
  category?: string
  qualityRating?: number
  notes?: string
  addToProducts?: boolean
  existingPurchaseId?: string
}

interface ReceiptItemsManagerProps {
  items: ReceiptItem[]
  onChange: (items: ReceiptItem[]) => void
  productCategories: string[]
  products?: ProductDocument[]
  purchases?: PurchaseDocument[]
  stores?: StoreDocument[]
  expenseStoreId?: string
}

export function ReceiptItemsManager({ items, onChange, productCategories, products, purchases, stores, expenseStoreId }: ReceiptItemsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0)

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
        {totalAmount > 0 && (
          <span className="text-[13px] text-text-hint">
            Итого: {totalAmount.toFixed(2)}
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
                  products={products}
                  purchases={purchases}
                  stores={stores}
                  expenseStoreId={expenseStoreId}
                  onSave={(updatedItem) => handleUpdate(item.id, updatedItem)}
                  onCancel={() => setEditingId(null)}
                />
              )
            }

            const subtitle = [item.manufacturer, item.packageVolume, item.variety, item.category].filter(Boolean).join(' · ')

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
                        {item.existingPurchaseId ? 'Привязано' : 'В продукты'}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-text-hint mt-0.5">
                    {item.amount > 0 ? `${item.amount.toFixed(2)} ${item.currency || DEFAULT_CURRENCY}` : '—'}
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
          products={products}
          purchases={purchases}
          stores={stores}
          expenseStoreId={expenseStoreId}
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
  products?: ProductDocument[]
  purchases?: PurchaseDocument[]
  stores?: StoreDocument[]
  expenseStoreId?: string
  onSave: (item: ReceiptItem) => void
  onCancel: () => void
}

function ReceiptItemForm({ item, productCategories, products, purchases, stores, expenseStoreId, onSave, onCancel }: ReceiptItemFormProps) {
  const [name, setName] = useState(item?.name || '')
  const [amount, setAmount] = useState(item?.amount.toString() || '')
  const [currency, setCurrency] = useState(item?.currency || DEFAULT_CURRENCY)
  const [manufacturer, setManufacturer] = useState(item?.manufacturer || '')
  const [packageVolume, setPackageVolume] = useState(item?.packageVolume || '')
  const [variety, setVariety] = useState(item?.variety || '')
  const [category, setCategory] = useState(item?.category || '')
  const [qualityRating, setQualityRating] = useState(item?.qualityRating || 0)
  const [notes, setNotes] = useState(item?.notes || '')
  const [addToProducts, setAddToProducts] = useState(item?.addToProducts || false)
  const [existingPurchaseId, setExistingPurchaseId] = useState<string | undefined>(item?.existingPurchaseId)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const nameWrapperRef = useRef<HTMLDivElement>(null)

  // Build store map once
  const storeMap = useMemo(() => new Map(stores?.map((s) => [s.id, s]) ?? []), [stores])

  // Suggestions: products with partial name match, enriched with latest purchase info
  const nameSuggestions = useMemo(() => {
    if (!name.trim() || !products) return []
    const query = name.trim().toLowerCase()
    return products
      .filter((p) => p.name.toLowerCase().includes(query))
      .map((product) => {
        // Find latest purchase for this product (prefer matching store)
        const productPurchases = purchases?.filter((pur) => pur.productId === product.id) ?? []
        const sorted = [...productPurchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
        const storeMatch = expenseStoreId ? sorted.find((p) => p.storeId === expenseStoreId) : undefined
        const latestPurchase = storeMatch ?? sorted[0]
        const store = latestPurchase ? storeMap.get(latestPurchase.storeId) : undefined
        return { product, purchase: latestPurchase, store }
      })
      .slice(0, 8)
  }, [name, products, purchases, storeMap, expenseStoreId])

  // Close name dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (nameWrapperRef.current && !nameWrapperRef.current.contains(e.target as Node)) {
        setNameDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Apply a suggestion: fill all fields from product + purchase
  const applySuggestion = (product: ProductDocument, purchase: PurchaseDocument | undefined) => {
    setName(product.name)
    setCategory(product.category || '')
    if (purchase) {
      setAmount(purchase.price.toFixed(2))
      setCurrency(purchase.currency || DEFAULT_CURRENCY)
      setManufacturer(purchase.manufacturer || '')
      setPackageVolume(purchase.packageVolume || '')
      setVariety(purchase.variety || '')
      setQualityRating(purchase.qualityRating ?? 0)
      setNotes(purchase.notes || '')
      setExistingPurchaseId(purchase.id)
    } else {
      setExistingPurchaseId(undefined)
    }
    setAddToProducts(true)
    setNameDropdownOpen(false)
  }

  // When name changes manually, clear the existing purchase link if name no longer matches
  const handleNameChange = (newName: string) => {
    setName(newName)
    setNameDropdownOpen(true)
    if (existingPurchaseId) {
      // Check if the linked purchase's product still matches the new name
      const linkedPurchase = purchases?.find((p) => p.id === existingPurchaseId)
      const linkedProduct = linkedPurchase ? products?.find((p) => p.id === linkedPurchase.productId) : undefined
      if (!linkedProduct || !linkedProduct.name.toLowerCase().includes(newName.trim().toLowerCase())) {
        setExistingPurchaseId(undefined)
      }
    }
  }

  const handleSubmit = () => {
    const trimmedName = name.trim()
    const parsedAmount = parseFloat(amount) || 0

    if (!trimmedName) return

    onSave({
      id: item?.id || crypto.randomUUID(),
      name: trimmedName,
      amount: parsedAmount > 0 ? parseFloat(parsedAmount.toFixed(2)) : 0,
      currency,
      manufacturer: manufacturer.trim() || undefined,
      packageVolume: packageVolume.trim() || undefined,
      variety: variety.trim() || undefined,
      category: category.trim() || undefined,
      qualityRating: qualityRating > 0 ? qualityRating : undefined,
      notes: notes.trim() || undefined,
      addToProducts,
      existingPurchaseId: addToProducts ? existingPurchaseId : undefined,
    })
  }

  return (
    <div className="bg-surface rounded-2xl p-3 space-y-3">
      <div className="text-[13px] text-section-header font-medium">
        {item ? 'Редактирование позиции' : 'Новая позиция'}
      </div>

      {/* Name with autocomplete */}
      <div ref={nameWrapperRef} className="relative">
        <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
          Название
          {existingPurchaseId && (
            <span className="ml-2 text-primary-text font-normal">· Привязано к покупке</span>
          )}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.currentTarget.value)}
          onFocus={() => setNameDropdownOpen(true)}
          placeholder="Молоко"
          autoFocus
          className="w-full bg-bg-secondary rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
        {nameDropdownOpen && nameSuggestions.length > 0 && (
          <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface rounded-xl shadow-lg border border-separator/30 py-1 z-50 max-h-48 overflow-y-auto">
            {nameSuggestions.map(({ product, purchase, store }) => {
              const subtitle = [purchase?.manufacturer, purchase?.packageVolume, purchase?.variety].filter(Boolean).join(' · ')
              return (
                <button
                  key={product.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applySuggestion(product, purchase)}
                  className="w-full px-4 py-2.5 text-left active:bg-bg-secondary/50 transition-colors"
                >
                  <div className="text-[14px] text-text font-medium">{product.name}</div>
                  {(subtitle || store || product.category) && (
                    <div className="text-[12px] text-text-hint mt-0.5">
                      {[subtitle, store?.name, product.category].filter(Boolean).join(' · ')}
                      {purchase && ` · ${purchase.price.toFixed(2)} ${purchase.currency}`}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Manufacturer */}
      <Input
        label="Производитель"
        value={manufacturer}
        onChange={(e) => setManufacturer(e.currentTarget.value)}
        placeholder="Савушкин"
      />

      {/* Package Volume & Variety */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Объём / вес"
          value={packageVolume}
          onChange={(e) => setPackageVolume(e.currentTarget.value)}
          placeholder="1л"
        />
        <Input
          label="Разновидность"
          value={variety}
          onChange={(e) => setVariety(e.currentTarget.value)}
          placeholder="Классическое"
        />
      </div>

      {/* Category */}
      <CategorySelect
        categories={productCategories}
        value={category}
        onChange={setCategory}
        inputClassName="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />

      {/* Amount */}
      <CurrencyAmountInput
        label="Сумма"
        amount={amount}
        currency={currency}
        onAmountChange={setAmount}
        onCurrencyChange={setCurrency}
        placeholder="3.50"
      />

      {/* Quality Rating */}
      <div>
        <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
          Оценка качества
        </label>
        <div className="flex gap-2 px-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setQualityRating(qualityRating === star ? 0 : star)}
              className="text-[24px] transition-all active:scale-110"
            >
              {star <= qualityRating ? '⭐' : '☆'}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
          Комментарий
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          placeholder="Заметки о продукте..."
          className="w-full bg-bg-secondary rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
          rows={2}
        />
      </div>

      {/* Add to products checkbox */}
      <div className="flex items-center gap-3 px-1">
        <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => {
          const next = !addToProducts
          setAddToProducts(next)
          if (!next) setExistingPurchaseId(undefined)
        }}>
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
          <span className="text-[15px] text-text">
            {existingPurchaseId ? 'Привязать к существующей покупке' : 'Добавить в продукты'}
          </span>
        </label>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
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
