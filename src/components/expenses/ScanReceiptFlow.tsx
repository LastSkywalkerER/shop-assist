import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAiSettings } from '../../contexts/AiSettingsContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useRxQuery, useRxCollection } from '../../db/hooks'
import { ReceiptCameraModal } from './ReceiptCameraModal'
import { runOcrPipeline, OcrError, type Pass, type OcrCatalog } from '../../lib/ai/ocrPipeline'
import {
  matchPurchaseForItem,
  matchStore,
  matchExpenseForReceipt,
  suggestExpenseLabel,
  AUTO_BIND_THRESHOLD,
} from '../../lib/ai/matching'
import { blobStorePut, addPendingUpload } from '../../db/blobStore'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  StoreDocument,
  ProductDocument,
  PurchaseDocument,
  ReceiptDocument,
  ReceiptItemDocument,
} from '../../db/types'
import type { AttachmentFile } from './FileUpload'
import type { ReceiptItem } from './ReceiptItemsManager'

interface ScanReceiptFlowProps {
  onClose: () => void
}

const PASS_LABELS: Record<Pass, string> = {
  extract: 'Распознавание чека…',
  validate: 'Проверка результата…',
  escalate: 'Уточнение распознавания…',
}

export function ScanReceiptFlow({ onClose }: ScanReceiptFlowProps) {
  const navigate = useNavigate()
  const { settings } = useAiSettings()
  const { showToast } = useToast()
  const confirm = useConfirm() // returns the confirm() function directly

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: products } = useRxQuery(productsCol)
  const { data: purchases } = useRxQuery(purchasesCol)
  const { data: expenseCategories } = useRxQuery(categoriesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)

  const [pass, setPass] = useState<Pass | null>(null)

  const handleCaptured = async (blob: Blob) => {
    if (!settings) {
      showToast('Настройки AI не загружены', 'error')
      onClose()
      return
    }

    // Build a compact catalog so the validate-pass model can match items
    // against the user's existing data with its own confidence. Caps are
    // chosen so the resulting JSON stays well under the model's context
    // budget even for heavy users.
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]))
    const categoryNameById = new Map(expenseCategories.map((c) => [c.id, c.name]))
    // Build expense → receipt-item-names lookup so we can show the model
    // what was actually purchased under each historical expense label.
    const expenseIdToItems = new Map<string, string[]>()
    {
      const receiptIdToItems = new Map<string, string[]>()
      for (const ri of receiptItems) {
        const arr = receiptIdToItems.get(ri.receiptId) ?? []
        if (arr.length < 5) arr.push(ri.name)
        receiptIdToItems.set(ri.receiptId, arr)
      }
      for (const r of receipts) {
        const items = receiptIdToItems.get(r.id)
        if (items && items.length) expenseIdToItems.set(r.expenseId, items)
      }
    }
    const catalog: OcrCatalog = {
      products: products.slice(0, 400).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category ?? null,
      })),
      categories: expenseCategories.map((c) => ({ id: c.id, name: c.name })),
      stores: stores.map((s) => ({ id: s.id, name: s.name })),
      expenses: [...expenses]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 150)
        .map((e) => ({
          id: e.id,
          name: e.name ?? null,
          category: e.categoryId ? (categoryNameById.get(e.categoryId) ?? null) : null,
          store: e.storeId ? (storeNameById.get(e.storeId) ?? null) : null,
          date: e.date.slice(0, 10),
          total: e.amount,
          items: expenseIdToItems.get(e.id),
        })),
    }

    setPass('extract')
    let parsed
    try {
      parsed = await runOcrPipeline(
        blob,
        {
          modelExtract: settings.modelExtract,
          modelValidate: settings.modelValidate,
          modelEscalate: settings.modelEscalate,
          defaultCurrency: DEFAULT_CURRENCY,
        },
        { onPass: setPass },
        { catalog },
      )
    } catch (err) {
      console.error('OCR pipeline failed:', err)
      const message = err instanceof OcrError ? err.message : 'Ошибка распознавания'
      showToast(message, 'error')
      setPass(null)
      onClose()
      return
    }

    // Persist the captured image to blob store so AddExpense can pick it up
    // via location.state by id (the blob itself can't cross the router).
    const attachmentId = crypto.randomUUID()
    const fileBlob = blob instanceof File
      ? blob
      : new File([blob], `receipt-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
    try {
      await blobStorePut(attachmentId, fileBlob)
      addPendingUpload(attachmentId)
    } catch (err) {
      console.error('Failed to persist receipt image:', err)
      // Continue without the attachment — user can re-attach in the form.
    }

    const matchedStore = matchStore(parsed.store?.name, stores)
    const modelMatches = parsed.matches ?? null

    // Existing-expense check: prefer the model's verdict if it was
    // confident, fall back to the local heuristic otherwise.
    const productIds = new Set(products.map((p) => p.id))
    const expenseIds = new Set(expenses.map((e) => e.id))
    const categoryIds = new Set(expenseCategories.map((c) => c.id))

    let duplicateExpenseId: string | null = null
    if (modelMatches?.existingExpenseId
      && expenseIds.has(modelMatches.existingExpenseId)
      && modelMatches.existingExpenseConfidence >= AUTO_BIND_THRESHOLD) {
      duplicateExpenseId = modelMatches.existingExpenseId
    } else {
      const fallback = matchExpenseForReceipt(parsed, matchedStore?.storeId ?? null, expenses)
      if (fallback && fallback.confidence >= AUTO_BIND_THRESHOLD) duplicateExpenseId = fallback.expenseId
    }

    if (duplicateExpenseId) {
      const exp = expenses.find((e) => e.id === duplicateExpenseId)
      const storeName = exp?.storeId ? stores.find((s) => s.id === exp.storeId)?.name : undefined
      const openExisting = await confirm({
        title: 'Похоже, такой расход уже есть',
        message: `${storeName ?? 'Магазин'} · ${(exp?.amount ?? 0).toFixed(2)} ${exp?.currency ?? ''} · ${exp ? new Date(exp.date).toLocaleDateString('ru-RU') : ''}. Открыть существующий?`,
        confirmLabel: 'Открыть',
        cancelLabel: 'Создать новый',
      })
      if (openExisting && exp) {
        navigate(`/expenses/${exp.id}`)
        onClose()
        return
      }
    }

    // Per-item match: prefer model confidence, but fall back to local
    // Jaccard for items the model didn't score or where it returned an
    // id we don't actually have in the catalog (defensive).
    const modelItemByIndex = new Map<number, { productId: string | null; confidence: number }>()
    for (const m of modelMatches?.items ?? []) {
      modelItemByIndex.set(m.itemIndex, { productId: m.productId, confidence: m.confidence })
    }

    // Build prefill payload for AddExpense.
    const items: ReceiptItem[] = parsed.items.map((it, idx) => {
      let bindPurchaseId: string | undefined
      const modelMatch = modelItemByIndex.get(idx)
      if (modelMatch && modelMatch.productId && productIds.has(modelMatch.productId)
        && modelMatch.confidence >= AUTO_BIND_THRESHOLD) {
        // Translate productId → most recent matching purchase (preferring
        // the same store as this receipt).
        const productPurchases = purchases.filter((p) => p.productId === modelMatch.productId)
        if (productPurchases.length) {
          const sorted = [...productPurchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
          const sameStore = matchedStore?.storeId
            ? sorted.find((p) => p.storeId === matchedStore.storeId)
            : undefined
          bindPurchaseId = (sameStore ?? sorted[0]).id
        }
      }
      if (!bindPurchaseId) {
        const localMatch = matchPurchaseForItem(it, products, purchases, matchedStore?.storeId)
        if (localMatch && localMatch.confidence >= AUTO_BIND_THRESHOLD) bindPurchaseId = localMatch.purchaseId
      }
      return {
        id: crypto.randomUUID(),
        name: it.name,
        amount: it.amount,
        currency: parsed.currency,
        manufacturer: it.manufacturer,
        packageVolume: it.packageVolume,
        addToProducts: !!bindPurchaseId,
        existingPurchaseId: bindPurchaseId,
      }
    })

    const attachments: AttachmentFile[] = [{
      id: attachmentId,
      fileName: fileBlob.name,
      mimeType: fileBlob.type,
      size: fileBlob.size,
    }]

    // Expense label/category: model first (validated against the catalog),
    // local heuristic only if the model didn't return anything usable.
    let suggestedName: string | undefined
    let suggestedCategoryId: string | undefined
    if (modelMatches && modelMatches.expenseLabelConfidence >= AUTO_BIND_THRESHOLD) {
      if (modelMatches.expenseName) suggestedName = modelMatches.expenseName
      if (modelMatches.expenseCategoryId && categoryIds.has(modelMatches.expenseCategoryId)) {
        suggestedCategoryId = modelMatches.expenseCategoryId
      }
    }
    if (!suggestedName || !suggestedCategoryId) {
      const localSuggestion = suggestExpenseLabel(parsed.items, {
        products,
        expenses,
        expenseCategories,
        receipts,
        receiptItems,
      })
      if (!suggestedName) suggestedName = localSuggestion.name
      if (!suggestedCategoryId) suggestedCategoryId = localSuggestion.categoryId
    }

    // Normalize date to YYYY-MM-DD for <input type="date">.
    let prefilledDate: string | undefined
    if (parsed.date) {
      const t = Date.parse(parsed.date)
      if (!Number.isNaN(t)) prefilledDate = new Date(t).toISOString().split('T')[0]
    }

    navigate('/expenses/add', {
      state: {
        ocrPrefill: {
          storeId: matchedStore?.storeId,
          storeName: parsed.store?.name,
          storeAddress: parsed.store?.address,
          date: prefilledDate,
          currency: parsed.currency,
          total: parsed.total,
          items,
          attachments,
          confidence: parsed.confidence,
          name: suggestedName,
          categoryId: suggestedCategoryId,
        },
      },
    })
    onClose()
  }

  return (
    <ReceiptCameraModal
      onCaptured={handleCaptured}
      onCancel={() => {
        if (pass) return // ignore close while processing
        onClose()
      }}
      processingLabel={pass ? PASS_LABELS[pass] : undefined}
    />
  )
}
