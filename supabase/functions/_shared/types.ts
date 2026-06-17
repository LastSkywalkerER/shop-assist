// Shared OCR types used by `ocr-receipt` and `start-receipt-scan` edge functions.

export type Pass = 'extract' | 'validate' | 'escalate'

export interface CatalogExpenseLabel {
  name: string
  categories: string[]
  stores: string[]
  items: string[]
}

export interface CatalogProduct {
  name: string
  categories: string[]
  stores: string[]
}

export interface Catalog {
  categoryNames?: string[]
  storeNames?: string[]
  expenseLabels?: CatalogExpenseLabel[]
  products?: CatalogProduct[]
}

export interface ReceiptItemPayload {
  name: string
  amount: number
  quantity: number
  needsReview: boolean
  packageVolume?: string | null
  manufacturer?: string | null
}

export interface ItemMatch {
  itemIndex: number
  cleanedName: string
  productName: string | null
  variety: string | null
  confidence: number
}

export interface ReceiptMatches {
  items: ItemMatch[]
  expenseLabel: string | null
  expenseCategoryName: string | null
  storeName: string | null
}

export interface ReceiptPayload {
  store?: { name: string; address?: string | null } | null
  date?: string | null
  currency: string
  total?: number | null
  items: ReceiptItemPayload[]
  confidence: number
  needsEscalation: boolean
  matches?: ReceiptMatches | null
}

// --- Bulk expense-list parsing (parse-expense-list edge function) ---

export interface ExpenseListRow {
  /** ISO date YYYY-MM-DD or null when the source line has no date. */
  date: string | null
  /** Human-readable expense name exactly as written in the source. */
  name: string
  /** Absolute (always positive) transaction value; the sign lives in `direction`. */
  amount: number
  /** Money out (expense) vs money in (income), from colour/sign of the amount. */
  direction: 'expense' | 'income'
  /** Row-specific currency, or null to fall back to the list currency. */
  currency: string | null
  /** Exact match from the provided known-labels list, or null. */
  matchedLabel: string | null
  /** Exact match from the provided category names, or null. */
  categoryName: string | null
  confidence: number
}

export interface ExpenseListPayload {
  currency: string
  rows: ExpenseListRow[]
}
