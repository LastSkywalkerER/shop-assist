// Server-side port of src/lib/ai/matching.ts. Pure functions — no Supabase
// client access here. Used by `start-receipt-scan` to translate the model's
// match names into ids and to detect duplicates.

import type { ReceiptPayload, ReceiptItemPayload } from './types.ts'

export const AUTO_BIND_THRESHOLD = 0.8

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 2)
}

export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection += 1
  const union = ta.size + tb.size - intersection
  const jaccard = intersection / union
  const lengthRatio = Math.min(ta.size, tb.size) / Math.max(ta.size, tb.size)
  return jaccard * (0.7 + 0.3 * lengthRatio)
}

export interface StoreLite { id: string; name: string }
export interface CategoryLite { id: string; name: string }
export interface ProductLite { id: string; name: string; category?: string | null }
export interface PurchaseLite {
  id: string
  product_id: string
  store_id: string
  purchase_date: string
}
export interface ExpenseLite {
  id: string
  name: string | null
  store_id: string | null
  category_id: string | null
  amount: number
  date: string
}

export interface PurchaseMatch {
  purchaseId: string
  productId: string
  confidence: number
}

export function matchPurchaseForItem(
  item: ReceiptItemPayload,
  products: ProductLite[],
  purchases: PurchaseLite[],
  storeId?: string | null,
): PurchaseMatch | null {
  let best: PurchaseMatch | null = null
  for (const product of products) {
    const sim = nameSimilarity(item.name, product.name)
    if (sim < 0.4) continue
    const productPurchases = purchases.filter((p) => p.product_id === product.id)
    if (productPurchases.length === 0) continue
    const sorted = [...productPurchases].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
    const sameStore = storeId ? sorted.find((p) => p.store_id === storeId) : undefined
    const purchase = sameStore ?? sorted[0]
    let confidence = sim
    if (sameStore) confidence = Math.min(1, confidence + 0.15)
    if (!best || confidence > best.confidence) {
      best = { purchaseId: purchase.id, productId: product.id, confidence }
    }
  }
  return best
}

export interface StoreMatch {
  storeId: string
  confidence: number
}

export function matchStore(parsedStoreName: string | null | undefined, stores: StoreLite[]): StoreMatch | null {
  if (!parsedStoreName) return null
  let best: StoreMatch | null = null
  for (const store of stores) {
    const sim = nameSimilarity(parsedStoreName, store.name)
    if (sim < 0.5) continue
    if (!best || sim > best.confidence) {
      best = { storeId: store.id, confidence: sim }
    }
  }
  return best
}

export interface ExpenseMatch {
  expenseId: string
  confidence: number
}

export function matchExpenseForReceipt(
  parsed: ReceiptPayload,
  matchedStoreId: string | null,
  expenses: ExpenseLite[],
): ExpenseMatch | null {
  if (!parsed.total || !matchedStoreId || !parsed.date) return null
  const targetTime = Date.parse(parsed.date)
  if (Number.isNaN(targetTime)) return null
  const dayMs = 24 * 60 * 60_000

  let best: ExpenseMatch | null = null
  for (const expense of expenses) {
    if (expense.store_id !== matchedStoreId) continue
    const t = Date.parse(expense.date)
    if (Number.isNaN(t)) continue
    if (Math.abs(t - targetTime) > dayMs) continue
    const tolerance = Math.max(0.5, expense.amount * 0.01)
    if (Math.abs(expense.amount - parsed.total) > tolerance) continue
    const dateScore = 1 - Math.abs(t - targetTime) / dayMs
    const amtScore = 1 - Math.abs(expense.amount - parsed.total) / tolerance
    const confidence = 0.5 + 0.25 * dateScore + 0.25 * amtScore
    if (!best || confidence > best.confidence) {
      best = { expenseId: expense.id, confidence }
    }
  }
  return best
}
