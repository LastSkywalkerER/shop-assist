import { useCallback, useState } from 'react'
import { useRxCollection } from '../db/hooks'
import type { ProductDocument } from '../db/types'
import { lookupBarcode, type LookupResult } from '../lib/barcode/lookup'
import { isValidBarcode } from '../lib/barcode/detector'

export type ScanFlowStage =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'lookup'; barcode: string }
  | { kind: 'result'; lookup: LookupResult }
  | { kind: 'manual'; barcode: string; hint: 'not-found' | 'offline' }

export interface BarcodeScanOutcome {
  product: ProductDocument
  lookup?: LookupResult
  createdNow: boolean
}

export interface UseBarcodeScanFlowOptions {
  onResolved: (outcome: BarcodeScanOutcome) => void
}

export function useBarcodeScanFlow({ onResolved }: UseBarcodeScanFlowOptions) {
  const productsCol = useRxCollection<ProductDocument>('products')
  const [stage, setStage] = useState<ScanFlowStage>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  const openScanner = useCallback(() => {
    setStage({ kind: 'scanning' })
  }, [])

  const close = useCallback(() => {
    setStage({ kind: 'idle' })
    setSaving(false)
  }, [])

  const findLocal = useCallback(async (barcode: string): Promise<ProductDocument | null> => {
    if (!productsCol) return null
    const doc = await productsCol.findOne({ selector: { barcode } }).exec()
    return doc ? (doc.toJSON() as ProductDocument) : null
  }, [productsCol])

  const handleDetected = useCallback(async (raw: string) => {
    const barcode = raw.replace(/\D/g, '')
    if (!isValidBarcode(barcode) && !/^[a-zA-Z0-9\-.:/]+$/.test(raw)) {
      // fall through to manual entry
      setStage({ kind: 'manual', barcode: '', hint: 'not-found' })
      return
    }
    const normalized = isValidBarcode(barcode) ? barcode : raw

    setStage({ kind: 'lookup', barcode: normalized })

    const existing = await findLocal(normalized)
    if (existing) {
      onResolved({ product: existing, createdNow: false })
      setStage({ kind: 'idle' })
      return
    }

    const lookup = await lookupBarcode(normalized)
    if (lookup.found) {
      setStage({ kind: 'result', lookup })
      return
    }
    setStage({
      kind: 'manual',
      barcode: normalized,
      hint: lookup.offline ? 'offline' : 'not-found',
    })
  }, [findLocal, onResolved])

  const createProduct = useCallback(async (data: {
    name: string
    category?: string
    barcode?: string
    brand?: string
    lookup?: LookupResult
  }) => {
    if (!productsCol) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const product: ProductDocument = {
        id: crypto.randomUUID(),
        name: data.name,
        category: data.category,
        barcode: data.barcode,
        createdAt: now,
        updatedAt: now,
      }
      await productsCol.insert(product)
      onResolved({ product, lookup: data.lookup, createdNow: true })
      setStage({ kind: 'idle' })
    } finally {
      setSaving(false)
    }
  }, [productsCol, onResolved])

  const confirmLookupResult = useCallback(async () => {
    if (stage.kind !== 'result') return
    const { lookup } = stage
    await createProduct({
      name: lookup.name?.trim() || '',
      category: lookup.category,
      barcode: lookup.barcode,
      brand: lookup.brand,
      lookup,
    })
  }, [stage, createProduct])

  const rejectLookupResult = useCallback(() => {
    if (stage.kind !== 'result') return
    setStage({
      kind: 'manual',
      barcode: stage.lookup.barcode,
      hint: 'not-found',
    })
  }, [stage])

  return {
    stage,
    saving,
    openScanner,
    close,
    handleDetected,
    createProduct,
    confirmLookupResult,
    rejectLookupResult,
  }
}
