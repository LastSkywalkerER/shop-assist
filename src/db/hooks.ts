import { useState, useEffect, createContext, useContext, useMemo } from 'react'
import type { RxCollection, MangoQuery } from 'rxdb'
import type { ShopAssistDatabase } from './database'

export const DatabaseContext = createContext<ShopAssistDatabase | null>(null)

export function useDatabase(): ShopAssistDatabase | null {
  return useContext(DatabaseContext)
}

export function useRxCollection<T>(
  name: 'products' | 'stores' | 'purchases' | 'expenseCategories' | 'expenses' | 'receipts' | 'receiptItems' | 'expenseAttachments' | 'shoppingListItems' | 'purchaseAttachments'
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
