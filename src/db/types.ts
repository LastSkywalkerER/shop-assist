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
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface ReceiptDocument {
  id: string
  expenseId: string
  createdAt: string
  updatedAt: string
}

export interface ReceiptItemDocument {
  id: string
  receiptId: string
  name: string
  amount: number
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
  dataUrl: string
  size: number
  createdAt: string
  updatedAt: string
}

export interface ShoppingListItemDocument {
  id: string
  name: string
  done: boolean
  createdAt: string
  updatedAt: string
}

export interface PurchaseAttachmentDocument {
  id: string
  purchaseId: string
  dataUrl: string
  createdAt: string
  updatedAt: string
}
