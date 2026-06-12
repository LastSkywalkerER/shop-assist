import { useState, useEffect, useLayoutEffect, useCallback, createContext, useContext, useMemo } from 'react'
import type { RxCollection, MangoQuery } from 'rxdb'
import type { ShopAssistDatabase } from './database'

export const DatabaseContext = createContext<ShopAssistDatabase | null>(null)

export function useDatabase(): ShopAssistDatabase | null {
  return useContext(DatabaseContext)
}

export function useRxCollection<T>(
  name: 'products' | 'stores' | 'purchases' | 'expenseCategories' | 'expenses' | 'expenseParticipants' | 'expenseSettlements' | 'receipts' | 'receiptItems' | 'expenseAttachments' | 'shoppingListItems' | 'purchaseAttachments' | 'currencyRates' | 'splitGroups'
): RxCollection<T> | null {
  const db = useDatabase()
  return (db?.[name] as RxCollection<T> | undefined) ?? null
}

export function useRxQuery<T>(
  collection: RxCollection<T> | null,
  queryObj?: MangoQuery<T>,
): { data: T[]; loading: boolean } {
  const [results, setResults] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const queryKey = useMemo(() => JSON.stringify(queryObj ?? {}), [queryObj])

  useEffect(() => {
    if (!collection) return
    const query = queryObj ? collection.find(queryObj) : collection.find()
    const sub = query.$.subscribe((docs) => {
      setResults(docs.map((d) => d.toJSON() as T))
      setLoading(false)
    })
    return () => sub.unsubscribe()
  }, [collection, queryKey])

  return { data: results, loading }
}

/**
 * Subscribes to a capped RxDB query and grows `limit` via `loadMore` (for infinite scroll).
 * When `resetKey` or `pageSize` changes, `limit` resets to `pageSize`.
 */
export function useRxPaginatedQuery<T>(
  collection: RxCollection<T> | null,
  buildQuery: (limit: number) => MangoQuery<T>,
  options: { pageSize: number; resetKey: string },
): { data: T[]; loading: boolean; hasMore: boolean; loadMore: () => void } {
  const { pageSize, resetKey } = options
  const [limit, setLimit] = useState(pageSize)

  useLayoutEffect(() => {
    setLimit(pageSize)
  }, [resetKey, pageSize])

  const queryObj = useMemo(() => buildQuery(limit), [buildQuery, limit])
  const queryKey = useMemo(() => JSON.stringify(queryObj), [queryObj])

  const [results, setResults] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!collection) return
    const query = collection.find(queryObj)
    const sub = query.$.subscribe((docs) => {
      setResults(docs.map((d) => d.toJSON() as T))
      setLoading(false)
    })
    return () => sub.unsubscribe()
  }, [collection, queryKey])

  const loadMore = useCallback(() => {
    setLimit((prev) => prev + pageSize)
  }, [pageSize])

  const hasMore = results.length >= limit

  return { data: results, loading, hasMore, loadMore }
}
