export interface ProductDocument {
  id: string
  name: string
  manufacturer?: string
  packageVolume?: string
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
  priceByn: number
  qualityRating?: number
  purchaseDate: string
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
  date: string
  categoryId?: string
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
  manufacturer?: string
  packageVolume?: string
  category?: string
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
