export interface ProductDocument {
  id: string
  name: string
  barcode?: string
  category?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface StoreDocument {
  id: string
  name: string
  type?: 'market' | 'store'
  address?: string
  chain?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface PurchaseDocument {
  id: string
  productId: string
  storeId: string
  price: number
  currency: string
  qualityRating?: number
  purchaseDate: string
  manufacturer?: string
  packageVolume?: string
  variety?: string
  notes?: string
  link?: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseCategoryDocument {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseDocument {
  id: string
  name?: string
  storeId?: string
  amount: number
  currency: string
  date: string
  categoryId?: string
  /** Split group this expense belongs to for the who-owes-whom settlement. */
  splitGroupId?: string
  notes?: string
  creatorName?: string
  createdAt: string
  updatedAt: string
}

/**
 * Settlement scope for shared expenses, decoupled from categories: categories
 * are an analytics dimension, split groups drive the who-owes-whom math.
 */
export interface SplitGroupDocument {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type ExpenseShareMode = 'equal' | 'amount' | 'items'

export interface ExpenseParticipantDocument {
  id: string
  expenseId: string
  /** Free-text name (same convention as expense.creatorName). */
  name: string
  shareMode: ExpenseShareMode
  /** Fixed owed sum; used when shareMode === 'amount'. */
  shareAmount?: number
  /** Receipt line-item ids; used when shareMode === 'items'. */
  itemIds?: string[]
  /** How much this person has already paid back toward the expense. */
  settledAmount?: number
  createdAt: string
  updatedAt: string
}

export interface ReceiptDocument {
  id: string
  expenseId: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseSettlementDocument {
  id: string
  /**
   * Settlement scope this repayment belongs to (not tied to any single
   * expense). Historically this held an expense category id; since split
   * groups were introduced, new records store a split group id here. The
   * field name is kept for sync compatibility (additive-only schema rule).
   */
  categoryId: string
  /** Person who paid (the debtor). */
  fromName: string
  /** Person who received the money (the creditor). */
  toName: string
  /** Amount in the base currency (BYN). */
  amount: number
  currency?: string
  createdAt: string
  updatedAt: string
}

export interface ReceiptItemDocument {
  id: string
  receiptId: string
  name: string
  /** Unit price (per 1 шт / 1 кг / 1 л). Line total = amount × quantity. */
  amount: number
  /** Count or weight/volume of the item (decimal, default 1). */
  quantity: number
  currency: string
  manufacturer?: string
  packageVolume?: string
  variety?: string
  category?: string
  qualityRating?: number
  notes?: string
  convertedToPurchaseId?: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseAttachmentDocument {
  id: string
  receiptId: string
  fileName: string
  mimeType: string
  size: number
  storagePath?: string
  createdAt: string
  updatedAt: string
}

export interface ShoppingListItemDocument {
  id: string
  name: string
  done: boolean
  link?: string
  creatorName?: string
  createdAt: string
  updatedAt: string
}

export interface PurchaseAttachmentDocument {
  id: string
  purchaseId: string
  fileName?: string
  mimeType?: string
  size?: number
  storagePath?: string
  createdAt: string
  updatedAt: string
}

export interface CurrencyRateDocument {
  id: string
  currency: string
  date: string
  rate: number
  scale: number
  source?: string
  createdAt: string
  updatedAt: string
}
