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
