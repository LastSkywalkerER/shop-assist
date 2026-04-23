import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument } from '../../db/types'
import { SearchBar } from './SearchBar'
import { CategoryFilter } from './CategoryFilter'
import { ProductTable } from './ProductTable'
import { FAB } from '../shared/FAB'
import { ScanFAB } from '../scanner/ScanFAB'
import { ScannerFlow } from '../scanner/ScannerFlow'
import { useBarcodeScanFlow } from '../../hooks/useBarcodeScanFlow'
import { useAuth } from '../../contexts/AuthContext'
import type { ProductRowData, StorePurchaseInfo } from './ProductRow'

export function Dashboard() {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const { data: products, loading } = useRxQuery(productsCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: purchases } = useRxQuery(purchasesCol)

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const scanFlow = useBarcodeScanFlow({
    onResolved: ({ product, lookup }) => {
      navigate('/add', {
        state: {
          productId: product.id,
          lookup,
        },
      })
    },
  })

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
      const prods = purchasesByProduct.get(p.id) ?? []
      const latestPurchase = prods.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))[0]
      const matchesSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        (latestPurchase?.manufacturer?.toLowerCase().includes(query) ?? false)
      const matchesCategory = !selectedCategory || p.category === selectedCategory
      return matchesSearch && matchesCategory
    })

    return filtered.map((product): ProductRowData => {
      const prods = purchasesByProduct.get(product.id) ?? []

      // Most recent purchase for subtitle info
      const sortedProds = [...prods].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
      const latestPurchase = sortedProds[0]

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

        let best = storePurchases[0].price
        let lastDate = storePurchases[0].purchaseDate
        let lastPrice = storePurchases[0].price
        let ratingSum = 0
        let ratingCount = 0

        for (const p of storePurchases) {
          if (p.price < best) best = p.price
          if (p.purchaseDate > lastDate) {
            lastDate = p.purchaseDate
            lastPrice = p.price
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
          currency: storePurchases[0].currency || 'BYN',
          avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
          count: storePurchases.length,
        })
      }

      // Sort: cheapest best price first
      storeInfos.sort((a, b) => a.bestPrice - b.bestPrice)

      return {
        productId: product.id,
        productName: product.name,
        manufacturer: latestPurchase?.manufacturer,
        packageVolume: latestPurchase?.packageVolume,
        variety: latestPurchase?.variety,
        category: product.category,
        stores: storeInfos,
        purchaseCount: prods.length,
      }
    })
  }, [products, stores, purchases, search, selectedCategory])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="glass-strong sticky top-0 z-10 border-b border-separator/15">
        <SearchBar value={search} onChange={setSearch} />
        {loading ? (
          <div className="px-4 pb-2.5 flex gap-2">
            {[48, 64, 56].map((w, i) => (
              <div key={i} className="h-7 rounded-full animate-pulse bg-text/10 shrink-0" style={{ width: w }} />
            ))}
          </div>
        ) : categories.length > 0 && (
          <CategoryFilter
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        )}
      </div>
      <ProductTable data={tableData} loading={loading} />
      {isAuthenticated && <ScanFAB onClick={scanFlow.openScanner} />}
      <FAB onClick={() => navigate('/add')} />
      {isAuthenticated && (
        <ScannerFlow
          stage={scanFlow.stage}
          saving={scanFlow.saving}
          categories={categories}
          onDetected={scanFlow.handleDetected}
          onCancel={scanFlow.close}
          onConfirmLookup={scanFlow.confirmLookupResult}
          onRejectLookup={scanFlow.rejectLookupResult}
          onCreateManual={scanFlow.createProduct}
        />
      )}
    </div>
  )
}
