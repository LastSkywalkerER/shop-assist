import type {
  ExpenseCategoryDocument,
  ExpenseDocument,
  ProductDocument,
  PurchaseDocument,
  ReceiptDocument,
  ReceiptItemDocument,
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

export interface ExpenseLabelSuggestion {
  name?: string
  categoryId?: string
  /** Aggregate confidence 0..1 across all collected votes. */
  confidence: number
}

/** Vote helper used by suggestExpenseLabel. */
function topVote<T extends string>(votes: Map<T, number>): { value: T; weight: number } | null {
  let best: { value: T; weight: number } | null = null
  for (const [value, weight] of votes) {
    if (!best || weight > best.weight) best = { value, weight }
  }
  return best
}

/**
 * Infer a likely expense name + category from the OCR items by looking at
 * what the user normally records for similar purchases. Two signals are
 * combined with weighted voting:
 *
 *   1. Direct product match: parsed item ↦ existing product ↦ product.category
 *      ↦ same-named expense_category.
 *   2. Historical receipt items: parsed item ↦ similar past receipt item ↦
 *      its receipt ↦ owning expense ↦ that expense's name/categoryId.
 *
 * The second signal is the more reliable one (it captures the actual label
 * the user previously chose) and is weighted higher.
 */
export function suggestExpenseLabel(
  items: ParsedReceiptItem[],
  ctx: {
    products: ProductDocument[]
    expenses: ExpenseDocument[]
    expenseCategories: ExpenseCategoryDocument[]
    receipts: ReceiptDocument[]
    receiptItems: ReceiptItemDocument[]
  },
): ExpenseLabelSuggestion {
  if (!items.length) return { confidence: 0 }

  const categoryVotes = new Map<string, number>()  // expense_category.id -> weight
  const nameVotes = new Map<string, number>()      // expense.name -> weight
  let totalWeight = 0

  // Build quick lookups.
  const receiptById = new Map(ctx.receipts.map((r) => [r.id, r]))
  const expenseById = new Map(ctx.expenses.map((e) => [e.id, e]))
  const categoryByLowerName = new Map(
    ctx.expenseCategories.map((c) => [c.name.toLowerCase(), c]),
  )

  for (const item of items) {
    // --- Signal 1: matching product → product.category → expense_category ---
    let bestProduct: { product: ProductDocument; sim: number } | null = null
    for (const product of ctx.products) {
      const sim = nameSimilarity(item.name, product.name)
      if (sim < 0.4) continue
      if (!bestProduct || sim > bestProduct.sim) bestProduct = { product, sim }
    }
    if (bestProduct && bestProduct.product.category) {
      const cat = categoryByLowerName.get(bestProduct.product.category.toLowerCase())
      if (cat) {
        const w = bestProduct.sim
        categoryVotes.set(cat.id, (categoryVotes.get(cat.id) ?? 0) + w)
        totalWeight += w
      }
    }

    // --- Signal 2: historical receipt items → expense ---
    let bestHistItem: { ri: ReceiptItemDocument; sim: number } | null = null
    for (const ri of ctx.receiptItems) {
      const sim = nameSimilarity(item.name, ri.name)
      if (sim < 0.55) continue
      if (!bestHistItem || sim > bestHistItem.sim) bestHistItem = { ri, sim }
    }
    if (bestHistItem) {
      const receipt = receiptById.get(bestHistItem.ri.receiptId)
      const expense = receipt ? expenseById.get(receipt.expenseId) : undefined
      if (expense) {
        const w = bestHistItem.sim * 1.5  // historical labels are stronger evidence
        if (expense.categoryId) {
          categoryVotes.set(expense.categoryId, (categoryVotes.get(expense.categoryId) ?? 0) + w)
        }
        if (expense.name) {
          nameVotes.set(expense.name, (nameVotes.get(expense.name) ?? 0) + w)
        }
        totalWeight += w
      }
    }
  }

  const topCat = topVote(categoryVotes)
  const topName = topVote(nameVotes)
  const confidence = totalWeight > 0
    ? Math.min(1, (topCat?.weight ?? 0) / totalWeight)
    : 0

  return {
    name: topName?.value,
    categoryId: topCat?.value,
    confidence,
  }
}
