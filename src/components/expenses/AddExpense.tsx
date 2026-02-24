import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ProductDocument,
  PurchaseDocument,
} from '../../db/types'
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import { FileUpload, type AttachmentFile } from './FileUpload'
import { ReceiptItemsManager, type ReceiptItem } from './ReceiptItemsManager'

export function AddExpense() {
  const navigate = useNavigate()

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: products } = useRxQuery(productsCol)
  const { data: purchases } = useRxQuery(purchasesCol)

  // Extract product categories
  const productCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const [name, setName] = useState('')
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(null)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategoryDocument | null>(null)
  const [notes, setNotes] = useState('')
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([])
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState('')

  // Validation: at least name OR store required, and amount > 0
  const canSubmit = (name.trim() || selectedStore) && amount && parseFloat(amount) > 0

  const handleCreateStore = async (data: { name: string; address?: string }) => {
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
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
    setSelectedStore(store)
  }

  const handleCreateCategory = async (categoryName: string) => {
    if (!categoriesCol) return
    const now = new Date().toISOString()
    const category: ExpenseCategoryDocument = {
      id: crypto.randomUUID(),
      name: categoryName,
      createdAt: now,
      updatedAt: now,
    }
    await categoriesCol.insert(category)
    setSelectedCategory(category)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !expensesCol) return

    // Validate
    if (!name.trim() && !selectedStore) {
      setValidationError('Укажите название или магазин')
      return
    }

    setSaving(true)
    setValidationError('')
    try {
      const now = new Date().toISOString()
      const expenseId = crypto.randomUUID()

      // 1. Insert expense
      await expensesCol.insert({
        id: expenseId,
        name: name.trim() || undefined,
        storeId: selectedStore?.id,
        amount: parseFloat(parseFloat(amount).toFixed(2)),
        currency,
        date: new Date(date).toISOString(),
        categoryId: selectedCategory?.id,
        notes: notes.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      })

      // 2. Lazy create receipt if needed (has attachments or items)
      const needsReceipt = attachments.length > 0 || receiptItems.length > 0
      if (needsReceipt && receiptsCol) {
        const receiptId = crypto.randomUUID()

        // Create receipt
        await receiptsCol.insert({
          id: receiptId,
          expenseId,
          createdAt: now,
          updatedAt: now,
        })

        // 3. Insert attachments
        if (attachments.length > 0 && attachmentsCol) {
          for (const attachment of attachments) {
            await attachmentsCol.insert({
              id: attachment.id,
              receiptId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              dataUrl: attachment.dataUrl,
              size: attachment.size,
              createdAt: now,
              updatedAt: now,
            })
          }
        }

        // 4. Insert receipt items and create products if needed
        if (receiptItems.length > 0 && receiptItemsCol) {
          for (const item of receiptItems) {
            let convertedToPurchaseId: string | undefined

            // Create product and purchase if requested
            if (item.addToProducts && productsCol && purchasesCol) {
              if (item.existingPurchaseId) {
                // Link to existing purchase and update it with form data
                convertedToPurchaseId = item.existingPurchaseId
                const purchaseDoc = await purchasesCol.findOne(item.existingPurchaseId).exec()
                if (purchaseDoc) {
                  await purchaseDoc.patch({
                    price: item.amount,
                    currency: item.currency || DEFAULT_CURRENCY,
                    manufacturer: item.manufacturer,
                    packageVolume: item.packageVolume,
                    variety: item.variety,
                    qualityRating: item.qualityRating,
                    notes: item.notes,
                    updatedAt: now,
                  })
                }
                if (!selectedStore) {
                  const existingPurchase = purchases.find((p) => p.id === item.existingPurchaseId)
                  const purchaseStore = existingPurchase ? stores.find((s) => s.id === existingPurchase.storeId) : null
                  if (purchaseStore) setSelectedStore(purchaseStore)
                }
              } else if (selectedStore) {
                // Find or create product
                let product = products.find((p) => p.name.toLowerCase() === item.name.toLowerCase())

                if (!product) {
                  const productId = crypto.randomUUID()
                  await productsCol.insert({
                    id: productId,
                    name: item.name,
                    category: item.category,
                    createdAt: now,
                    updatedAt: now,
                  })
                  product = { id: productId, name: item.name, createdAt: now, updatedAt: now } as ProductDocument
                }

                // Create purchase
                const purchaseId = crypto.randomUUID()
                await purchasesCol.insert({
                  id: purchaseId,
                  productId: product.id,
                  storeId: selectedStore.id,
                  price: item.amount,
                  currency: item.currency || DEFAULT_CURRENCY,
                  manufacturer: item.manufacturer,
                  packageVolume: item.packageVolume,
                  variety: item.variety,
                  qualityRating: item.qualityRating,
                  purchaseDate: new Date(date).toISOString(),
                  notes: item.notes,
                  createdAt: now,
                  updatedAt: now,
                })

                convertedToPurchaseId = purchaseId
              }
            }

            // Insert receipt item
            await receiptItemsCol.insert({
              id: item.id,
              receiptId,
              name: item.name,
              amount: item.amount,
              currency: item.currency || DEFAULT_CURRENCY,
              manufacturer: item.manufacturer,
              packageVolume: item.packageVolume,
              variety: item.variety,
              category: item.category,
              qualityRating: item.qualityRating,
              notes: item.notes,
              convertedToPurchaseId,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
      }

      navigate('/expenses')
    } catch (err) {
      console.error('Failed to save expense:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4 pb-10 overflow-y-auto flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Новый расход</h2>
        <button
          onClick={() => navigate('/expenses')}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Отмена
        </button>
      </div>

      {/* Expense name */}
      <ExpenseNameAutocomplete expenses={expenses} value={name} onChange={setName} />

      {/* Store selector */}
      <StoreSelect stores={stores} selected={selectedStore} onSelect={setSelectedStore} onCreate={handleCreateStore} />

      {/* Amount & Date row */}
      <div className="grid grid-cols-2 gap-3">
        <CurrencyAmountInput
          label="Сумма"
          amount={amount}
          currency={currency}
          onAmountChange={setAmount}
          onCurrencyChange={setCurrency}
          placeholder="45.50"
          required
        />
        <Input label="Дата" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      </div>

      {/* Category selector */}
      <ExpenseCategorySelect
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
        onCreate={handleCreateCategory}
      />

      {/* Notes/Comment */}
      <div>
        <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
          Комментарий
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          placeholder="Дополнительная информация о расходе..."
          className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
          rows={2}
        />
      </div>

      {/* File upload */}
      <FileUpload attachments={attachments} onChange={setAttachments} />

      {/* Receipt items */}
      <ReceiptItemsManager
        items={receiptItems}
        onChange={setReceiptItems}
        productCategories={productCategories}
        products={products}
        purchases={purchases}
        stores={stores}
        expenseStoreId={selectedStore?.id}
      />

      {/* Validation error */}
      {validationError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-[13px] text-destructive">
          {validationError}
        </div>
      )}

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
