import type {
  ExpenseDocument,
  ProductDocument,
  PurchaseDocument,
  StoreDocument,
} from '../../db/types'
import type { ParsedReceipt, ParsedReceiptItem } from './ocrPipeline'

/** Threshold for auto-binding an OCR item to an existing purchase. */
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

/**
 * Token-set Jaccard with length-ratio penalty. Returns 0..1.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection += 1
  const union = ta.size + tb.size - intersection
  const jaccard = intersection / union
  // Penalize cases where one name is much longer (e.g. "Молоко" vs "Молоко
  // Савушкин 1л отборное 3.6%" — still match, but with reduced confidence).
  const lengthRatio = Math.min(ta.size, tb.size) / Math.max(ta.size, tb.size)
  return jaccard * (0.7 + 0.3 * lengthRatio)
}

export interface PurchaseMatch {
  purchaseId: string
  productId: string
  confidence: number
}

/**
 * Find the best existing purchase for a parsed receipt item. Confidence is
 * boosted when the purchase comes from the same store as the receipt.
 */
export function matchPurchaseForItem(
  item: ParsedReceiptItem,
  products: ProductDocument[],
  purchases: PurchaseDocument[],
  storeId?: string,
): PurchaseMatch | null {
  let best: PurchaseMatch | null = null

  for (const product of products) {
    const sim = nameSimilarity(item.name, product.name)
    if (sim < 0.4) continue
    const productPurchases = purchases.filter((p) => p.productId === product.id)
    if (productPurchases.length === 0) continue
    const sorted = [...productPurchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    const sameStore = storeId ? sorted.find((p) => p.storeId === storeId) : undefined
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

export function matchStore(parsedStoreName: string | undefined, stores: StoreDocument[]): StoreMatch | null {
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

/**
 * Heuristic: same store, date within ±1 day, total within 1% of expense
 * amount → strong match. Use to prompt the user before creating a duplicate.
 */
export function matchExpenseForReceipt(
  parsed: ParsedReceipt,
  matchedStoreId: string | null,
  expenses: ExpenseDocument[],
): ExpenseMatch | null {
  if (!parsed.total || !matchedStoreId || !parsed.date) return null
  const targetTime = Date.parse(parsed.date)
  if (Number.isNaN(targetTime)) return null
  const dayMs = 24 * 60 * 60_000

  let best: ExpenseMatch | null = null
  for (const expense of expenses) {
    if (expense.storeId !== matchedStoreId) continue
    const t = Date.parse(expense.date)
    if (Number.isNaN(t)) continue
    if (Math.abs(t - targetTime) > dayMs) continue
    const tolerance = Math.max(0.5, expense.amount * 0.01)
    if (Math.abs(expense.amount - parsed.total) > tolerance) continue
    // Confidence rises as both date and amount tighten in.
    const dateScore = 1 - Math.abs(t - targetTime) / dayMs
    const amtScore = 1 - Math.abs(expense.amount - parsed.total) / tolerance
    const confidence = 0.5 + 0.25 * dateScore + 0.25 * amtScore
    if (!best || confidence > best.confidence) {
      best = { expenseId: expense.id, confidence }
    }
  }
  return best
}
