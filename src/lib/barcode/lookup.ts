import { supabase } from '../supabase/client'

export type LookupSource = 'off' | 'obf' | 'opf' | 'gs1' | null

export interface LookupResult {
  found: boolean
  barcode: string
  name?: string
  brand?: string
  category?: string
  imageUrl?: string
  imageLargeUrl?: string
  volume?: string
  genericName?: string
  stores?: string[]
  labels?: string[]
  nutriscoreGrade?: string
  novaGroup?: number
  officialUrl?: string
  source: LookupSource
  /** Set when lookup failed due to network / server error rather than a real miss. */
  offline?: boolean
}

export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  try {
    const { data, error } = await supabase.functions.invoke('lookup-product-by-barcode', {
      body: { barcode },
    })
    if (error) {
      return { found: false, barcode, source: null, offline: true }
    }
    if (!data || typeof data !== 'object') {
      return { found: false, barcode, source: null, offline: true }
    }
    const result = data as LookupResult
    return {
      found: !!result.found,
      barcode: result.barcode || barcode,
      name: result.name,
      brand: result.brand,
      category: result.category,
      imageUrl: result.imageUrl,
      imageLargeUrl: result.imageLargeUrl,
      volume: result.volume,
      genericName: result.genericName,
      stores: result.stores,
      labels: result.labels,
      nutriscoreGrade: result.nutriscoreGrade,
      novaGroup: result.novaGroup,
      officialUrl: result.officialUrl,
      source: result.source ?? null,
    }
  } catch {
    return { found: false, barcode, source: null, offline: true }
  }
}
