// Build the grouped catalog the validate pass needs, plus all the room-scoped
// tables required to resolve the model's name-based matches back into ids.
// Mirrors the client-side catalog logic from src/components/expenses/ScanReceiptFlow.tsx
// and src/lib/ai/matching.ts so the server produces identical prefill output
// to what the synchronous flow used to.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Catalog } from './types.ts'
import type {
  StoreLite,
  CategoryLite,
  ProductLite,
  PurchaseLite,
  ExpenseLite,
} from './matching.ts'

export interface RoomData {
  stores: StoreLite[]
  categories: CategoryLite[]
  products: ProductLite[]
  purchases: PurchaseLite[]
  expenses: ExpenseLite[]
  receipts: Array<{ id: string; expense_id: string }>
  receiptItems: Array<{ receipt_id: string; converted_to_purchase_id: string | null }>
}

type QueryBuilder = ReturnType<ReturnType<SupabaseClient['from']>['select']>

export async function loadRoomData(supabase: SupabaseClient, roomId: string): Promise<RoomData> {
  const notDeleted = (q: QueryBuilder) => q.eq('room_id', roomId).eq('_deleted', false)

  const [stores, categories, products, purchases, expenses, receipts, receiptItems] = await Promise.all([
    notDeleted(supabase.from('stores_sync').select('id, name')),
    notDeleted(supabase.from('expense_categories_sync').select('id, name')),
    notDeleted(supabase.from('products_sync').select('id, name, category')),
    notDeleted(supabase.from('purchases_sync').select('id, product_id, store_id, purchase_date')),
    notDeleted(supabase.from('expenses_sync').select('id, name, store_id, category_id, amount, date')),
    notDeleted(supabase.from('receipts_sync').select('id, expense_id')),
    notDeleted(supabase.from('receipt_items_sync').select('receipt_id, converted_to_purchase_id')),
  ])

  return {
    stores: (stores.data ?? []) as StoreLite[],
    categories: (categories.data ?? []) as CategoryLite[],
    products: (products.data ?? []) as ProductLite[],
    purchases: (purchases.data ?? []) as PurchaseLite[],
    expenses: (expenses.data ?? []) as ExpenseLite[],
    receipts: (receipts.data ?? []) as Array<{ id: string; expense_id: string }>,
    receiptItems: (receiptItems.data ?? []) as Array<{ receipt_id: string; converted_to_purchase_id: string | null }>,
  }
}

export function buildCatalog(data: RoomData): Catalog {
  const productById = new Map<string, ProductLite>()
  for (const p of data.products) productById.set(p.id, p)
  const storeNameById = new Map<string, string>()
  for (const s of data.stores) storeNameById.set(s.id, s.name)
  const categoryNameById = new Map<string, string>()
  for (const c of data.categories) categoryNameById.set(c.id, c.name)

  const receiptToExpense = new Map<string, string>()
  for (const r of data.receipts) receiptToExpense.set(r.id, r.expense_id)

  const expenseToReceipts = new Map<string, string[]>()
  for (const r of data.receipts) {
    const arr = expenseToReceipts.get(r.expense_id) ?? []
    arr.push(r.id)
    expenseToReceipts.set(r.expense_id, arr)
  }

  const receiptToItems = new Map<string, Array<{ receipt_id: string; converted_to_purchase_id: string | null }>>()
  for (const ri of data.receiptItems) {
    const arr = receiptToItems.get(ri.receipt_id) ?? []
    arr.push(ri)
    receiptToItems.set(ri.receipt_id, arr)
  }

  const purchaseById = new Map<string, PurchaseLite>()
  for (const p of data.purchases) purchaseById.set(p.id, p)

  // Index 1: expenseLabels[].
  type LabelEntry = { name: string; categories: Set<string>; stores: Set<string>; items: Set<string> }
  const labelMap = new Map<string, LabelEntry>()
  for (const exp of data.expenses) {
    const name = exp.name?.trim()
    if (!name) continue
    let entry = labelMap.get(name)
    if (!entry) {
      entry = { name, categories: new Set(), stores: new Set(), items: new Set() }
      labelMap.set(name, entry)
    }
    const catName = exp.category_id ? categoryNameById.get(exp.category_id) : undefined
    if (catName) entry.categories.add(catName)
    const stName = exp.store_id ? storeNameById.get(exp.store_id) : undefined
    if (stName) entry.stores.add(stName)
    const rids = expenseToReceipts.get(exp.id) ?? []
    for (const rid of rids) {
      const items = receiptToItems.get(rid) ?? []
      for (const ri of items) {
        if (!ri.converted_to_purchase_id) continue
        const purchase = purchaseById.get(ri.converted_to_purchase_id)
        if (!purchase) continue
        const product = productById.get(purchase.product_id)
        if (product?.name) entry.items.add(product.name.trim())
      }
    }
  }

  // Index 2: products[].
  type ProductEntry = { name: string; categories: Set<string>; stores: Set<string> }
  const productMap = new Map<string, ProductEntry>()
  const purchaseToExpense = new Map<string, string>()
  for (const ri of data.receiptItems) {
    if (!ri.converted_to_purchase_id) continue
    const expId = receiptToExpense.get(ri.receipt_id)
    if (expId) purchaseToExpense.set(ri.converted_to_purchase_id, expId)
  }
  const expenseById = new Map<string, ExpenseLite>()
  for (const e of data.expenses) expenseById.set(e.id, e)
  for (const purchase of data.purchases) {
    const product = productById.get(purchase.product_id)
    if (!product?.name) continue
    let entry = productMap.get(product.id)
    if (!entry) {
      entry = { name: product.name.trim(), categories: new Set(), stores: new Set() }
      productMap.set(product.id, entry)
    }
    const stName = purchase.store_id ? storeNameById.get(purchase.store_id) : undefined
    if (stName) entry.stores.add(stName)
    const expId = purchaseToExpense.get(purchase.id)
    if (expId) {
      const exp = expenseById.get(expId)
      const catName = exp?.category_id ? categoryNameById.get(exp.category_id) : undefined
      if (catName) entry.categories.add(catName)
    }
  }

  return {
    categoryNames: [...new Set(data.categories.map((c) => c.name.trim()).filter(Boolean))],
    storeNames:    [...new Set(data.stores.map((s) => s.name.trim()).filter(Boolean))],
    expenseLabels: [...labelMap.values()].map((e) => ({
      name: e.name,
      categories: [...e.categories],
      stores:     [...e.stores],
      items:      [...e.items],
    })),
    products: [...productMap.values()].map((p) => ({
      name: p.name,
      categories: [...p.categories],
      stores:     [...p.stores],
    })),
  }
}
