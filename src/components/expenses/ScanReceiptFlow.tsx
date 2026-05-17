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
      categoryNames: dedupe(expenseCategories.map((c) => c.name), 100),
      storeNames: dedupe(stores.map((s) => s.name), 80),
      expenseLabels: dedupe(sortedExpenses.map((e) => e.name), 100),
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

    // Duplicate detection runs entirely locally — store+date+total triple.
    const dupMatch = matchExpenseForReceipt(parsed, matchedStore?.storeId ?? null, expenses)
    if (dupMatch && dupMatch.confidence >= AUTO_BIND_THRESHOLD) {
      const exp = expenses.find((e) => e.id === dupMatch.expenseId)
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

    // Per-item: model gives us cleanedName + optional productName + variety.
    // Use those verbatim; if productName matches a real product above the
    // bind threshold, link this item to the latest purchase of that product.
    const modelItemByIndex = new Map<number, {
      cleanedName: string
      productName: string | null
      variety: string | null
      confidence: number
    }>()
    for (const m of modelMatches?.items ?? []) {
      modelItemByIndex.set(m.itemIndex, {
        cleanedName: m.cleanedName,
        productName: m.productName,
        variety: m.variety,
        confidence: m.confidence,
      })
    }

    const items: ReceiptItem[] = parsed.items.map((it, idx) => {
      const modelMatch = modelItemByIndex.get(idx)

      // Display name: prefer model's cleanedName, fall back to raw OCR name.
      const displayName = (modelMatch?.cleanedName?.trim()) || it.name

      // Variety: prefer model's extracted codes, fall back to nothing.
      const variety = modelMatch?.variety?.trim() || undefined

      // Bind to existing purchase only when the model is confident.
      let bindPurchaseId: string | undefined
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
        const localMatch = matchPurchaseForItem({ ...it, name: displayName }, products, purchases, matchedStore?.storeId)
        if (localMatch && localMatch.confidence >= AUTO_BIND_THRESHOLD) bindPurchaseId = localMatch.purchaseId
      }
      return {
        id: crypto.randomUUID(),
        name: displayName,
        amount: it.amount,
        currency: parsed.currency,
        manufacturer: it.manufacturer,
        packageVolume: it.packageVolume,
        variety,
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

    // Expense label / category: trust the model's pick directly (no threshold —
    // it's a pre-fill that the user can edit). Category goes through an exact
    // name → id lookup, label is free-form text.
    let suggestedName: string | undefined = modelMatches?.expenseLabel?.trim() || undefined
    let suggestedCategoryId: string | undefined
    if (modelMatches?.expenseCategoryName) {
      const cat = categoryByName.get(modelMatches.expenseCategoryName.trim().toLowerCase())
      if (cat) suggestedCategoryId = cat.id
    }
    // Local heuristic as a last-resort fallback if the model returned nothing.
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
