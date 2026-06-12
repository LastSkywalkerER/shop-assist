import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ExpenseParticipantDocument,
  ProductDocument,
  PurchaseDocument,
  ShoppingListItemDocument,
  SplitGroupDocument,
} from '../../db/types'
import { ExpenseNameAutocomplete } from './ExpenseNameAutocomplete'
import { StoreSelect } from '../purchase/StoreSelect'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import { SplitGroupSelect } from './SplitGroupSelect'
import { Input } from '../shared/Input'
import { CurrencyAmountInput } from '../shared/CurrencyAmountInput'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import { FileUpload, type AttachmentFile } from './FileUpload'
import { ReceiptItemsManager, type ReceiptItem } from './ReceiptItemsManager'
import { ExpenseSplitManager, type SplitParticipant } from './ExpenseSplitManager'
import { CreatorField } from '../shared/CreatorField'
import { useAuth } from '../../contexts/AuthContext'
import { addPendingUpload, blobStorePut, blobStoreGet } from '../../db/blobStore'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { supabase } from '../../lib/supabase/client'
import { deletePendingScan, promotePendingScan } from '../../lib/ai/pendingScans'
import { collectGroupParticipantNames, mergeGroupParticipants } from '../../lib/expenses/splitting'
import { markScanConsumed } from '../../lib/ai/consumedScans'

export function AddExpense() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, roomId } = useAuth()

  const locState = location.state as {
    prefilledItems?: ShoppingListItemDocument[]
    ocrPrefill?: {
      storeId?: string
      storeName?: string
      storeAddress?: string
      date?: string
      currency?: string
      total?: number
      items?: ReceiptItem[]
      attachments?: AttachmentFile[]
      confidence?: number
      name?: string
      categoryId?: string
      /** Set when arriving from a pending_receipt_scans row — the storage
       * object is already uploaded under this path and must be promoted
       * rather than re-uploaded. The id is the pending row id. */
      pendingScanId?: string
      pendingScanStoragePath?: string
      pendingScanMime?: string
      duplicateOfExpenseId?: string | null
    }
  } | null
  const prefilledItems = locState?.prefilledItems
  const ocrPrefill = locState?.ocrPrefill
  const pendingScanId = ocrPrefill?.pendingScanId
  const pendingScanPath = ocrPrefill?.pendingScanStoragePath

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')
  const splitGroupsCol = useRxCollection<SplitGroupDocument>('splitGroups')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: products } = useRxQuery(productsCol)
  const { data: purchases } = useRxQuery(purchasesCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: splitGroups } = useRxQuery(splitGroupsCol)

  // Extract product categories
  const productCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const [name, setName] = useState(() => ocrPrefill?.name ?? '')
  const [selectedStore, setSelectedStore] = useState<StoreDocument | null>(null)
  const [amount, setAmount] = useState(() => (ocrPrefill?.total ? ocrPrefill.total.toFixed(2) : ''))
  const [currency, setCurrency] = useState(ocrPrefill?.currency ?? DEFAULT_CURRENCY)
  const [date, setDate] = useState(() => ocrPrefill?.date || new Date().toISOString().split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategoryDocument | null>(null)
  const [selectedSplitGroup, setSelectedSplitGroup] = useState<SplitGroupDocument | null>(null)
  const [notes, setNotes] = useState('')
  const [attachments, setAttachments] = useState<AttachmentFile[]>(() => ocrPrefill?.attachments ?? [])
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>(() => {
    if (ocrPrefill?.items?.length) {
      return ocrPrefill.items.map((it) => ({ ...it, quantity: it.quantity ?? 1 }))
    }
    if (prefilledItems?.length) {
      return prefilledItems.map((item) => ({ id: crypto.randomUUID(), name: item.name, amount: 0, quantity: 1, currency: DEFAULT_CURRENCY }))
    }
    return []
  })
  const [creatorName, setCreatorName] = useState(user?.first_name ?? '')
  const [participants, setParticipants] = useState<SplitParticipant[]>([])
  const [saving, setSaving] = useState(false)

  // Names already used across the selected split group — seeded as equal-split
  // participants when the split section is opened.
  const groupParticipantNames = useMemo(() => {
    const groupId = selectedSplitGroup?.id
    if (!groupId) return []
    return collectGroupParticipantNames(groupId, expenses, allParticipants)
  }, [expenses, allParticipants, selectedSplitGroup?.id])
  const confirm = useConfirm()

  // Picking a split group pulls its known members into the split right away
  // (the split section auto-expands once participants appear).
  const handleSelectSplitGroup = (group: SplitGroupDocument | null) => {
    setSelectedSplitGroup(group)
    if (!group) return
    const names = collectGroupParticipantNames(group.id, expenses, allParticipants)
    setParticipants((prev) => mergeGroupParticipants(prev, creatorName, names) as SplitParticipant[])
  }

  // When arriving from a pending scan, the image is already in Supabase
  // Storage. Hydrate the local blobStore so FileUpload's preview works, and
  // synthesize an attachment entry pointing to the existing storage path.
  useEffect(() => {
    if (!pendingScanId || !pendingScanPath) return
    if (attachments.some((a) => a.id === pendingScanId)) return
    let cancelled = false
    ;(async () => {
      try {
        const cached = await blobStoreGet(pendingScanId)
        if (!cached) {
          const { data, error } = await supabase.storage
            .from('sync-attachments')
            .download(pendingScanPath)
          if (error || !data) return
          await blobStorePut(pendingScanId, data)
        }
        if (cancelled) return
        const blob = await blobStoreGet(pendingScanId)
        if (!blob) return
        setAttachments((prev) => prev.some((a) => a.id === pendingScanId) ? prev : [...prev, {
          id: pendingScanId,
          fileName: `receipt-${pendingScanId.slice(0, 8)}.jpg`,
          mimeType: blob.type || ocrPrefill?.pendingScanMime || 'image/jpeg',
          size: blob.size,
        }])
      } catch (err) {
        console.warn('Failed to hydrate pending scan attachment:', err)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScanId, pendingScanPath])

  // Fill in default author name once user auth state is resolved
  useEffect(() => {
    if (user?.first_name && !creatorName) setCreatorName(user.first_name)
  }, [user?.first_name])
  const [validationError, setValidationError] = useState('')

  // Validation: at least name OR store required, and amount > 0
  const canSubmit = (name.trim() || selectedStore) && amount && parseFloat(amount) > 0

  const handleCreateStore = async (data: { name: string; address?: string }): Promise<StoreDocument | undefined> => {
    if (!storesCol) return undefined
    // Dedup: find existing store with same name (case-insensitive) and same address
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

  // Resolve OCR-prefilled store: auto-select if we matched an existing one,
  // otherwise create a new store from the parsed name once stores load.
  useEffect(() => {
    if (!ocrPrefill || selectedStore) return
    if (ocrPrefill.storeId) {
      const existing = stores.find((s) => s.id === ocrPrefill.storeId)
      if (existing) setSelectedStore(existing)
      return
    }
    if (ocrPrefill.storeName && storesCol) {
      void handleCreateStore({ name: ocrPrefill.storeName, address: ocrPrefill.storeAddress })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, ocrPrefill?.storeId, ocrPrefill?.storeName])

  // Resolve OCR-suggested expense category once categories load.
  useEffect(() => {
    if (!ocrPrefill?.categoryId || selectedCategory) return
    const cat = categories.find((c) => c.id === ocrPrefill.categoryId)
    if (cat) setSelectedCategory(cat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, ocrPrefill?.categoryId])

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

  const handleCreateSplitGroup = async (groupName: string) => {
    if (!splitGroupsCol) return
    const now = new Date().toISOString()
    const group: SplitGroupDocument = {
      id: crypto.randomUUID(),
      name: groupName,
      createdAt: now,
      updatedAt: now,
    }
    await splitGroupsCol.insert(group)
    setSelectedSplitGroup(group)
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
        splitGroupId: selectedSplitGroup?.id,
        notes: notes.trim() || undefined,
        creatorName: creatorName.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      })

      // 1b. Insert split participants (skip blank rows)
      if (participantsCol) {
        for (const part of participants) {
          const trimmed = part.name.trim()
          if (!trimmed) continue
          await participantsCol.insert({
            id: part.id,
            expenseId,
            name: trimmed,
            shareMode: part.shareMode,
            shareAmount: part.shareMode === 'amount' ? part.shareAmount : undefined,
            itemIds: part.shareMode === 'items' ? (part.itemIds ?? []) : undefined,
            settledAmount: part.settledAmount ?? 0,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

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

        // 3. Insert attachments (blob already in store from FileUpload)
        if (attachments.length > 0 && attachmentsCol) {
          for (const attachment of attachments) {
            // Attachment promoted from a pending scan is already in Storage;
            // record its existing path so the sync layer doesn't try to
            // re-upload it.
            const isPromoted = pendingScanId
              && pendingScanPath
              && attachment.id === pendingScanId
            if (!isPromoted) addPendingUpload(attachment.id)
            await attachmentsCol.insert({
              id: attachment.id,
              receiptId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              size: attachment.size,
              ...(isPromoted ? { storagePath: pendingScanPath } : {}),
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

            // Insert receipt item. `needsReview` is transient UI state only —
            // it's deliberately not persisted.
            await receiptItemsCol.insert({
              id: item.id,
              receiptId,
              name: item.name,
              amount: item.amount,
              quantity: item.quantity ?? 1,
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

      // If this expense came from a pending scan, drop the pending row
      // (storage object stays — it's now bound to the attachment). The local
      // expense is already saved at this point, so hide the card immediately
      // (even offline) to prevent a second save re-inserting the same
      // receiptItem / attachment ids → RxDB CONFLICT. The remote row delete is
      // best-effort and retried by usePendingScans once the network is back.
      if (pendingScanId) {
        markScanConsumed(pendingScanId)
        try {
          await promotePendingScan(pendingScanId)
        } catch (err) {
          console.warn('Failed to delete pending scan row after promotion:', err)
        }
      }

      navigate(-1)
    } catch (err) {
      console.error('Failed to save expense:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!pendingScanId) {
      navigate(-1)
      return
    }
    const ok = await confirm({
      title: 'Отменить распознавание?',
      message: 'Загруженный чек будет удалён без сохранения.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Назад',
      destructive: true,
    })
    if (!ok) return
    try {
      await deletePendingScan(pendingScanId, pendingScanPath ?? undefined)
    } catch (err) {
      console.warn('Failed to delete pending scan:', err)
    }
    navigate(-1)
  }

  return (
    <div className="p-4 space-y-4 pb-10 overflow-y-auto flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Новый расход</h2>
        <button
          onClick={handleCancel}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Отмена
        </button>
      </div>

      {ocrPrefill && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-text shrink-0">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <div className="text-[12px] text-text-hint flex-1 min-w-0">
            Распознано с фото · проверьте поля перед сохранением
            {typeof ocrPrefill.confidence === 'number' && (
              <span className="ml-1.5 text-text/60">({Math.round(ocrPrefill.confidence * 100)}%)</span>
            )}
            {ocrPrefill.duplicateOfExpenseId && (
              <div className="mt-1 text-amber-700 dark:text-amber-400 font-medium">
                Возможный дубль уже существующего расхода — проверьте перед сохранением.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expense name */}
      <ExpenseNameAutocomplete
        expenses={expenses}
        value={name}
        onChange={setName}
        onSelectSuggestion={(_, categoryId) => {
          if (categoryId) {
            const cat = categories.find((c) => c.id === categoryId)
            if (cat) setSelectedCategory(cat)
          }
        }}
      />

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

      {/* Author */}
      <CreatorField value={creatorName} onChange={setCreatorName} roomId={roomId} />

      {/* Split group (settlement scope) + split between participants */}
      <SplitGroupSelect
        groups={splitGroups}
        selected={selectedSplitGroup}
        onSelect={handleSelectSplitGroup}
        onCreate={handleCreateSplitGroup}
      />
      <ExpenseSplitManager
        participants={participants}
        onChange={setParticipants}
        expenseAmount={parseFloat(amount) || 0}
        currency={currency}
        receiptItems={receiptItems}
        payerName={creatorName}
        groupParticipantNames={groupParticipantNames}
        roomId={roomId}
      />

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
