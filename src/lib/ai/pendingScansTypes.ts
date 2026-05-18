// Shape of pending_receipt_scans.prefill_payload produced by the
// `start-receipt-scan` edge function. Mirrors
// supabase/functions/_shared/resolve.ts → PrefillPayload exactly.

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
