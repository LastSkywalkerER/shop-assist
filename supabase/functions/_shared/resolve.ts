// Server-side equivalent of the post-OCR resolution that ScanReceiptFlow.tsx
// used to do on the client. Turns the model's name-based matches into ids
// the AddExpense form can apply directly, and produces a duplicate hint.

import type { ReceiptPayload } from './types.ts'
import {
  AUTO_BIND_THRESHOLD,
  matchPurchaseForItem,
  matchStore,
  matchExpenseForReceipt,
  type ExpenseLite,
  type ProductLite,
  type StoreLite,
  type CategoryLite,
  type PurchaseLite,
} from './matching.ts'
import { categoryIdForLabel, suggestLabelFromHistory } from './labelSuggestion.ts'

export interface PrefillItem {
  id: string
  name: string
  amount: number
  quantity: number
  currency: string
  manufacturer?: string | null
  packageVolume?: string | null
  variety?: string | null
  addToProducts: true
  existingPurchaseId?: string
  needsReview?: boolean
}

export interface PrefillPayload {
  storeId?: string
  storeName?: string
  storeAddress?: string
  date?: string
  currency: string
  total?: number
  items: PrefillItem[]
  confidence: number
  name?: string
  categoryId?: string
}

export interface ResolveResult {
  prefill: PrefillPayload
  duplicateOfExpenseId: string | null
}

export function resolveMatches(
  parsed: ReceiptPayload,
  room: {
    stores: StoreLite[]
    categories: CategoryLite[]
    products: ProductLite[]
    purchases: PurchaseLite[]
    expenses: ExpenseLite[]
    receipts: Array<{ id: string; expense_id: string }>
    receiptItems: Array<{ receipt_id: string; name?: string | null }>
  },
): ResolveResult {
  const modelMatches = parsed.matches ?? null

  const productByName = new Map<string, ProductLite>()
  for (const p of room.products) productByName.set(p.name.trim().toLowerCase(), p)
  const categoryByName = new Map<string, CategoryLite>()
  for (const c of room.categories) categoryByName.set(c.name.trim().toLowerCase(), c)
  const storeByName = new Map<string, StoreLite>()
  for (const s of room.stores) storeByName.set(s.name.trim().toLowerCase(), s)

  // Store id resolution: trust the model first, fall back to fuzzy local match.
  let matchedStoreId: string | null = null
  if (modelMatches?.storeName) {
    const s = storeByName.get(modelMatches.storeName.trim().toLowerCase())
    if (s) matchedStoreId = s.id
  }
  if (!matchedStoreId) {
    const local = matchStore(parsed.store?.name, room.stores)
    if (local) matchedStoreId = local.storeId
  }

  // Duplicate detection — strict same-store + ±1d + ±1%.
  const dupMatch = matchExpenseForReceipt(parsed, matchedStoreId, room.expenses)
  const duplicateOfExpenseId =
    dupMatch && dupMatch.confidence >= AUTO_BIND_THRESHOLD ? dupMatch.expenseId : null

  // Per-item: prefer model's cleanedName + product binding; fall back to local heuristic.
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

  const items: PrefillItem[] = parsed.items.map((it, idx) => {
    const modelMatch = modelItemByIndex.get(idx)
    const displayName = (modelMatch?.cleanedName?.trim()) || it.name
    const variety = modelMatch?.variety?.trim() || undefined

    let bindPurchaseId: string | undefined
    if (modelMatch?.productName && modelMatch.confidence >= AUTO_BIND_THRESHOLD) {
      const product = productByName.get(modelMatch.productName.trim().toLowerCase())
      if (product) {
        const productPurchases = room.purchases.filter((p) => p.product_id === product.id)
        if (productPurchases.length) {
          const sorted = [...productPurchases].sort((a, b) =>
            b.purchase_date.localeCompare(a.purchase_date))
          const sameStore = matchedStoreId
            ? sorted.find((p) => p.store_id === matchedStoreId)
            : undefined
          bindPurchaseId = (sameStore ?? sorted[0]).id
        }
      }
    }
    if (!bindPurchaseId) {
      const localMatch = matchPurchaseForItem(
        { ...it, name: displayName },
        room.products,
        room.purchases,
        matchedStoreId,
      )
      if (localMatch && localMatch.confidence >= AUTO_BIND_THRESHOLD) {
        bindPurchaseId = localMatch.purchaseId
      }
    }

    return {
      id: crypto.randomUUID(),
      name: displayName,
      amount: it.amount,
      quantity: it.quantity ?? 1,
      currency: parsed.currency,
      manufacturer: it.manufacturer ?? undefined,
      packageVolume: it.packageVolume ?? undefined,
      variety,
      addToProducts: true,
      existingPurchaseId: bindPurchaseId,
      needsReview: it.needsReview === true ? true : undefined,
    }
  })

  // Expense label / category: trust the model's pick (no threshold — it's a pre-fill).
  let suggestedName: string | undefined = modelMatches?.expenseLabel?.trim() || undefined
  let suggestedCategoryId: string | undefined
  if (modelMatches?.expenseCategoryName) {
    const cat = categoryByName.get(modelMatches.expenseCategoryName.trim().toLowerCase())
    if (cat) suggestedCategoryId = cat.id
  }

  // The validate pass is best-effort: when it times out or errors, `matches`
  // stays empty and the form used to open with a blank name. Vote a label out
  // of the room's own history instead of shipping nothing.
  if (!suggestedName) {
    const fallback = suggestLabelFromHistory(
      { storeName: parsed.store?.name, items: parsed.items },
      matchedStoreId,
      { expenses: room.expenses, receipts: room.receipts, receiptItems: room.receiptItems },
    )
    suggestedName = fallback.name
    if (!suggestedCategoryId) suggestedCategoryId = fallback.categoryId
  } else if (!suggestedCategoryId) {
    // Model named the expense but skipped the category (it often does) —
    // reuse whatever category that same label carried last time.
    suggestedCategoryId = categoryIdForLabel(suggestedName, room.expenses)
  }

  let prefilledDate: string | undefined
  if (parsed.date) {
    const t = Date.parse(parsed.date)
    if (!Number.isNaN(t)) prefilledDate = new Date(t).toISOString().split('T')[0]
  }

  const prefill: PrefillPayload = {
    storeId: matchedStoreId ?? undefined,
    storeName: parsed.store?.name,
    storeAddress: parsed.store?.address ?? undefined,
    date: prefilledDate,
    currency: parsed.currency,
    total: parsed.total ?? undefined,
    items,
    confidence: parsed.confidence,
    name: suggestedName,
    categoryId: suggestedCategoryId,
  }

  return { prefill, duplicateOfExpenseId }
}
