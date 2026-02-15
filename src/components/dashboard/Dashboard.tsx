import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument } from '../../db/types'
import { SearchBar } from './SearchBar'
import { CategoryFilter } from './CategoryFilter'
import { ProductTable } from './ProductTable'
import { FAB } from '../shared/FAB'
import type { ProductRowData, StorePurchaseInfo } from './ProductRow'

export function Dashboard() {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const navigate = useNavigate()

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const products = useRxQuery(productsCol)
  const stores = useRxQuery(storesCol)
  const purchases = useRxQuery(purchasesCol)

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const tableData: ProductRowData[] = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s]))
    const purchasesByProduct = new Map<string, PurchaseDocument[]>()

    for (const p of purchases) {
      const list = purchasesByProduct.get(p.productId) ?? []
      list.push(p)
      purchasesByProduct.set(p.productId, list)
    }

    const query = search.toLowerCase()
    const filtered = products.filter((p) => {
      const matchesSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.manufacturer?.toLowerCase().includes(query) ?? false)
      const matchesCategory = !selectedCategory || p.category === selectedCategory
      return matchesSearch && matchesCategory
    })

    return filtered.map((product): ProductRowData => {
      const prods = purchasesByProduct.get(product.id) ?? []

      // Group by store
      const byStore = new Map<string, PurchaseDocument[]>()
      for (const p of prods) {
        const list = byStore.get(p.storeId) ?? []
        list.push(p)
        byStore.set(p.storeId, list)
      }

      const storeInfos: StorePurchaseInfo[] = []
      for (const [storeId, storePurchases] of byStore) {
        const store = storeMap.get(storeId)
        const storeName = store?.name ?? 'Неизвестный'

        let best = storePurchases[0].priceByn
        let lastDate = storePurchases[0].purchaseDate
        let lastPrice = storePurchases[0].priceByn
        let ratingSum = 0
        let ratingCount = 0

        for (const p of storePurchases) {
          if (p.priceByn < best) best = p.priceByn
          if (p.purchaseDate > lastDate) {
            lastDate = p.purchaseDate
            lastPrice = p.priceByn
          }
          if (p.qualityRating != null) {
            ratingSum += p.qualityRating
            ratingCount++
          }
        }

        storeInfos.push({
          storeName,
          bestPrice: best,
          lastPrice,
          avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
          count: storePurchases.length,
        })
      }

      // Sort: cheapest best price first
      storeInfos.sort((a, b) => a.bestPrice - b.bestPrice)

      return {
        productId: product.id,
        productName: product.name,
        packageVolume: product.packageVolume,
        manufacturer: product.manufacturer,
        category: product.category,
        stores: storeInfos,
        purchaseCount: prods.length,
      }
    })
  }, [products, stores, purchases, search, selectedCategory])

  return (
    <>
      <SearchBar value={search} onChange={setSearch} />
      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}
      <ProductTable data={tableData} />
      <FAB onClick={() => navigate('/add')} />
    </>
  )
}
