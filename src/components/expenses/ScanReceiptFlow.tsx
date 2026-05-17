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

    // Build a grouped catalog. The flat name lists are kept only for fields
    // the model must return verbatim (storeName, expenseCategoryName).
    // expenseLabels[] and products[] are the indexes the model walks for
    // matching — see VALIDATE_PROMPT in supabase/functions/ocr-receipt for
    // the exact algorithm.
    const productById = new Map<string, ProductDocument>()
    for (const p of products) productById.set(p.id, p)
    const storeNameById = new Map<string, string>()
    for (const s of stores) storeNameById.set(s.id, s.name)
    const categoryNameById = new Map<string, string>()
    for (const c of expenseCategories) categoryNameById.set(c.id, c.name)

    // receipt.id → expense.id
    const receiptToExpense = new Map<string, string>()
    for (const r of receipts) receiptToExpense.set(r.id, r.expenseId)
    // expense.id → receipt.id[] (one expense may have multiple receipts)
    const expenseToReceipts = new Map<string, string[]>()
    for (const r of receipts) {
      const arr = expenseToReceipts.get(r.expenseId) ?? []
      arr.push(r.id)
      expenseToReceipts.set(r.expenseId, arr)
    }
    // receipt.id → receiptItem[]
    const receiptToItems = new Map<string, typeof receiptItems>()
    for (const ri of receiptItems) {
      const arr = receiptToItems.get(ri.receiptId) ?? []
      arr.push(ri)
      receiptToItems.set(ri.receiptId, arr)
    }
    // purchase.id → purchase (for convertedToPurchaseId lookups)
    const purchaseById = new Map<string, PurchaseDocument>()
    for (const p of purchases) purchaseById.set(p.id, p)

    // Index 1: expenseLabels[]. Group expenses by their .name. For each
    // group collect the unique categories, stores, and product-names
    // (resolved through receipts → converted purchases → product).
    type LabelEntry = { name: string; categories: Set<string>; stores: Set<string>; items: Set<string> }
    const labelMap = new Map<string, LabelEntry>()
    for (const exp of expenses) {
      const name = exp.name?.trim()
      if (!name) continue
      let entry = labelMap.get(name)
      if (!entry) {
        entry = { name, categories: new Set(), stores: new Set(), items: new Set() }
        labelMap.set(name, entry)
      }
      const catName = exp.categoryId ? categoryNameById.get(exp.categoryId) : undefined
      if (catName) entry.categories.add(catName)
      const stName = exp.storeId ? storeNameById.get(exp.storeId) : undefined
      if (stName) entry.stores.add(stName)
      // Walk receipts → items → converted purchase → product.name
      const rids = expenseToReceipts.get(exp.id) ?? []
      for (const rid of rids) {
        const items = receiptToItems.get(rid) ?? []
        for (const ri of items) {
          if (!ri.convertedToPurchaseId) continue
          const purchase = purchaseById.get(ri.convertedToPurchaseId)
          if (!purchase) continue
          const product = productById.get(purchase.productId)
          if (product?.name) entry.items.add(product.name.trim())
        }
      }
    }

    // Index 2: products[]. Group purchases by productId; cross-reference
    // each purchase back to its expense (via receiptItem.convertedToPurchaseId
    // → receipt.expenseId) to collect the expense categories where this
    // product showed up. Stores come directly from purchase.storeId.
    type ProductEntry = { name: string; categories: Set<string>; stores: Set<string> }
    const productMap = new Map<string, ProductEntry>()
    // Reverse index: purchase.id → expense.id (via receiptItem chain).
    const purchaseToExpense = new Map<string, string>()
    for (const ri of receiptItems) {
      if (!ri.convertedToPurchaseId) continue
      const expId = receiptToExpense.get(ri.receiptId)
      if (expId) purchaseToExpense.set(ri.convertedToPurchaseId, expId)
    }
    const expenseById = new Map<string, ExpenseDocument>()
    for (const e of expenses) expenseById.set(e.id, e)
    for (const purchase of purchases) {
      const product = productById.get(purchase.productId)
      if (!product?.name) continue
      let entry = productMap.get(product.id)
      if (!entry) {
        entry = { name: product.name.trim(), categories: new Set(), stores: new Set() }
        productMap.set(product.id, entry)
      }
      const stName = purchase.storeId ? storeNameById.get(purchase.storeId) : undefined
      if (stName) entry.stores.add(stName)
      const expId = purchaseToExpense.get(purchase.id)
      if (expId) {
        const exp = expenseById.get(expId)
        const catName = exp?.categoryId ? categoryNameById.get(exp.categoryId) : undefined
        if (catName) entry.categories.add(catName)
      }
    }

    const catalog: OcrCatalog = {
      categoryNames: [...new Set(expenseCategories.map((c) => c.name.trim()).filter(Boolean))],
      storeNames:    [...new Set(stores.map((s) => s.name.trim()).filter(Boolean))],
      expenseLabels: [...labelMap.values()].map((e) => ({
        name: e.name,
        categories: [...e.categories],
        stores:     [...e.stores],
        items:      [...e.items],
      })),
      products: [...productMap.values()].map((p) => ({
        name: p.name,
        categories: [...p.categories],
        stores:     [...p.stores],
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

    const modelMatches = parsed.matches ?? null

    // Lookup helpers — model returns names, we resolve to ids by exact
    // match against the catalog the client just built.
    const productByName = new Map<string, ProductDocument>()
    for (const p of products) productByName.set(p.name.trim().toLowerCase(), p)
    const categoryByName = new Map<string, ExpenseCategoryDocument>()
    for (const c of expenseCategories) categoryByName.set(c.name.trim().toLowerCase(), c)
    const storeByName = new Map<string, StoreDocument>()
    for (const s of stores) storeByName.set(s.name.trim().toLowerCase(), s)

    // Store: trust the model's pick if it matched something in storeNames,
    // otherwise fall back to local fuzzy match against receipt.store.name.
    let matchedStore: { storeId: string } | null = null
    if (modelMatches?.storeName) {
      const s = storeByName.get(modelMatches.storeName.trim().toLowerCase())
      if (s) matchedStore = { storeId: s.id }
    }
    if (!matchedStore) {
      const local = matchStore(parsed.store?.name, stores)
      if (local) matchedStore = { storeId: local.storeId }
    }

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
        // Always add scanned items to the product catalog so they appear on
        // the main tab. If we matched an existing purchase, link to it;
        // otherwise a new product/purchase will be created on save.
        addToProducts: true,
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
