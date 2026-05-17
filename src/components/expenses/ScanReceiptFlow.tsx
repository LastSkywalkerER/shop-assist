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

    // Build a names-only catalog. The model returns names; the client
    // resolves them back to ids below. Keeps the validate prompt small.
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]))
    const categoryNameById = new Map(expenseCategories.map((c) => [c.id, c.name]))

    // expense.id → up to 5 receipt-item names (for the label inference
    // signal — "past Одежда expense had a футболка in it").
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

    const dedupe = (arr: Array<string | undefined | null>, cap: number): string[] => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const v of arr) {
        if (!v) continue
        const trimmed = v.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
        if (out.length >= cap) break
      }
      return out
    }

    const sortedExpenses = [...expenses].sort((a, b) => b.date.localeCompare(a.date))

    const catalog: OcrCatalog = {
      productNames: dedupe(products.map((p) => p.name), 300),
      categoryNames: expenseCategories.map((c) => c.name),
      storeNames: dedupe(stores.map((s) => s.name), 80),
      expenseLabels: dedupe(sortedExpenses.map((e) => e.name), 50),
      recentExpenses: sortedExpenses.slice(0, 50).map((e) => ({
        label: e.name ?? null,
        category: e.categoryId ? (categoryNameById.get(e.categoryId) ?? null) : null,
        store: e.storeId ? (storeNameById.get(e.storeId) ?? null) : null,
        date: e.date.slice(0, 10),
        total: e.amount,
        items: expenseIdToItems.get(e.id) ?? [],
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

    // Lookup helpers — model returns names, we resolve to ids by exact
    // match against the catalog the client just built.
    const productByName = new Map<string, ProductDocument>()
    for (const p of products) productByName.set(p.name.trim().toLowerCase(), p)
    const categoryByName = new Map<string, ExpenseCategoryDocument>()
    for (const c of expenseCategories) categoryByName.set(c.name.trim().toLowerCase(), c)
    const storeByName = new Map<string, StoreDocument>()
    for (const s of stores) storeByName.set(s.name.trim().toLowerCase(), s)

    // Duplicate detection: model describes the dupe by date/total/store,
    // we resolve it to a concrete expense locally.
    let duplicateExpenseId: string | null = null
    if (modelMatches?.duplicateConfidence
      && modelMatches.duplicateConfidence >= AUTO_BIND_THRESHOLD
      && modelMatches.duplicateDate && modelMatches.duplicateTotal != null) {
      const dupStoreId = modelMatches.duplicateStoreName
        ? storeByName.get(modelMatches.duplicateStoreName.trim().toLowerCase())?.id
        : undefined
      const targetTime = Date.parse(modelMatches.duplicateDate)
      if (!Number.isNaN(targetTime)) {
        const tolerance = Math.max(0.5, modelMatches.duplicateTotal * 0.01)
        const hit = expenses.find((e) => {
          if (dupStoreId && e.storeId !== dupStoreId) return false
          const t = Date.parse(e.date)
          if (Number.isNaN(t)) return false
          if (Math.abs(t - targetTime) > 24 * 60 * 60_000) return false
          return Math.abs(e.amount - modelMatches.duplicateTotal!) <= tolerance
        })
        if (hit) duplicateExpenseId = hit.id
      }
    }
    if (!duplicateExpenseId) {
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

    // Per-item match: model returns productName; resolve to id locally.
    const modelItemByIndex = new Map<number, { productName: string | null; confidence: number }>()
    for (const m of modelMatches?.items ?? []) {
      modelItemByIndex.set(m.itemIndex, { productName: m.productName, confidence: m.confidence })
    }

    // Build prefill payload for AddExpense.
    const items: ReceiptItem[] = parsed.items.map((it, idx) => {
      let bindPurchaseId: string | undefined
      const modelMatch = modelItemByIndex.get(idx)
      if (modelMatch?.productName && modelMatch.confidence >= AUTO_BIND_THRESHOLD) {
        const product = productByName.get(modelMatch.productName.trim().toLowerCase())
        if (product) {
          const productPurchases = purchases.filter((p) => p.productId === product.id)
          if (productPurchases.length) {
            const sorted = [...productPurchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
            const sameStore = matchedStore?.storeId
              ? sorted.find((p) => p.storeId === matchedStore.storeId)
              : undefined
            bindPurchaseId = (sameStore ?? sorted[0]).id
          }
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

    // Expense label/category: model returns names; resolve category name
    // to id; fall back to local Jaccard for either field when missing.
    let suggestedName: string | undefined
    let suggestedCategoryId: string | undefined
    if (modelMatches && modelMatches.expenseLabelConfidence >= AUTO_BIND_THRESHOLD) {
      if (modelMatches.expenseLabel) suggestedName = modelMatches.expenseLabel
      if (modelMatches.expenseCategoryName) {
        const cat = categoryByName.get(modelMatches.expenseCategoryName.trim().toLowerCase())
        if (cat) suggestedCategoryId = cat.id
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
