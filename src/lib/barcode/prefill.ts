import type { LookupResult } from './lookup'
import { serializeLinkMeta, type LinkMeta } from '../linkMeta'

type UrlMeta = LinkMeta

/** Fields we can autofill on the AddPurchase form from a barcode lookup. */
export interface LookupPrefill {
  manufacturer?: string
  packageVolume?: string
  variety?: string
  notes?: string
  link?: string
  urlMeta?: UrlMeta
  /** Name of a store suggested by OFF; caller may match against the local list. */
  suggestedStoreName?: string
  /** Best image URL to auto-attach (prefers the large original). */
  imageUrl?: string
}

function buildNotes(lookup: LookupResult): string | undefined {
  const parts: string[] = []
  if (lookup.nutriscoreGrade) parts.push(`Nutri-Score: ${lookup.nutriscoreGrade.toUpperCase()}`)
  if (lookup.novaGroup) parts.push(`NOVA: ${lookup.novaGroup}`)
  if (lookup.labels?.length) parts.push(lookup.labels.slice(0, 3).join(', '))
  return parts.length ? parts.join(' · ') : undefined
}

export function buildLookupPrefill(lookup: LookupResult): LookupPrefill {
  const prefill: LookupPrefill = {}

  if (lookup.brand) prefill.manufacturer = lookup.brand
  if (lookup.volume) prefill.packageVolume = lookup.volume
  if (lookup.genericName) prefill.variety = lookup.genericName

  const notes = buildNotes(lookup)
  if (notes) prefill.notes = notes

  if (lookup.officialUrl) {
    const urlMeta: UrlMeta = {
      url: lookup.officialUrl,
      title: lookup.name,
      description: lookup.genericName,
      image: lookup.imageUrl,
    }
    prefill.urlMeta = urlMeta
    prefill.link = serializeLinkMeta(urlMeta)
  }

  if (lookup.stores?.length) prefill.suggestedStoreName = lookup.stores[0]

  const img = lookup.imageLargeUrl || lookup.imageUrl
  if (img) prefill.imageUrl = img

  return prefill
}

/** Download a remote image and convert to a File for the local blob store. */
export async function fetchRemoteImage(url: string, barcode?: string): Promise<File | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const ext = (blob.type.match(/image\/(\w+)/)?.[1] ?? 'jpg').toLowerCase()
    const name = barcode ? `off-${barcode}.${ext}` : `off.${ext}`
    return new File([blob], name, { type: blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}
