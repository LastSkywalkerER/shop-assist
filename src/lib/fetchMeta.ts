import { supabase } from './supabase/client'

export interface PageMeta {
  title?: string
  description?: string
  image?: string
  favicon?: string
}

/** Google favicon service — always works, no CORS issues */
function faviconFallback(url: string): string {
  try {
    const { hostname } = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return ''
  }
}

/**
 * Fetch page meta via the Supabase Edge Function.
 * The edge function tries ScrapingBee first (handles antibot), then falls back to direct fetch.
 */
export async function fetchPageMeta(url: string): Promise<PageMeta> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-meta', { body: { url } })
    if (!error && data && !data.error) {
      return {
        title: data.title || undefined,
        description: data.description || undefined,
        image: data.image || undefined,
        favicon: data.favicon || faviconFallback(url),
      }
    }
  } catch {
    // edge function failed
  }

  return { favicon: faviconFallback(url) }
}
