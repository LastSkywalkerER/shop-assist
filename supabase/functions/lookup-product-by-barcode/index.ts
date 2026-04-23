import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const USER_AGENT = 'ShopAssist/1.9.0 (https://github.com/LastSkywalkerer/shop-assist)'

type LookupSource = 'off' | 'obf' | 'opf' | 'gs1' | null

interface LookupResult {
  found: boolean
  barcode: string
  name?: string
  brand?: string
  category?: string
  imageUrl?: string
  source: LookupSource
}

const FACTS_HOSTS: Array<{ host: string; source: Exclude<LookupSource, null | 'gs1'> }> = [
  { host: 'world.openfoodfacts.org', source: 'off' },
  { host: 'world.openbeautyfacts.org', source: 'obf' },
  { host: 'world.openproductsfacts.org', source: 'opf' },
]

async function fetchJson(url: string, timeoutMs = 6000): Promise<any | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function cleanCategoryTag(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  return tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim() || undefined
}

async function queryOpenFacts(host: string, source: Exclude<LookupSource, null | 'gs1'>, barcode: string): Promise<LookupResult | null> {
  const fields = 'product_name,product_name_ru,brands,categories_tags,image_front_small_url'
  const url = `https://${host}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`
  const data = await fetchJson(url)
  if (!data || data.status !== 1 || !data.product) return null
  const p = data.product

  const name = typeof p.product_name_ru === 'string' && p.product_name_ru.trim()
    ? p.product_name_ru.trim()
    : typeof p.product_name === 'string' && p.product_name.trim()
      ? p.product_name.trim()
      : undefined
  if (!name) return null

  const brand = typeof p.brands === 'string' ? p.brands.split(',')[0]?.trim() || undefined : undefined
  const category = Array.isArray(p.categories_tags) && p.categories_tags.length > 0
    ? cleanCategoryTag(p.categories_tags[p.categories_tags.length - 1])
    : undefined
  const imageUrl = typeof p.image_front_small_url === 'string' ? p.image_front_small_url : undefined

  return { found: true, barcode, name, brand, category, imageUrl, source }
}

// Best-effort fallback: GS1 Digital Link resolver redirects a GTIN to a brand-owner URL.
// If that URL resolves to an HTML page, delegate to fetch-meta to extract OG title + image.
async function queryGs1DigitalLink(barcode: string): Promise<LookupResult | null> {
  let redirectUrl: string | null = null
  const resolveController = new AbortController()
  const resolveTimeout = setTimeout(() => resolveController.abort(), 5000)
  try {
    const res = await fetch(`https://id.gs1.org/01/${encodeURIComponent(barcode)}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: resolveController.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc && /^https?:\/\//i.test(loc) && !loc.includes('id.gs1.org')) {
      redirectUrl = loc
    }
  } catch {
    return null
  } finally {
    clearTimeout(resolveTimeout)
  }
  if (!redirectUrl) return null

  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return null

  const metaController = new AbortController()
  const metaTimeout = setTimeout(() => metaController.abort(), 8000)
  try {
    const metaFetch = await fetch(`${base}/functions/v1/fetch-meta`, {
      method: 'POST',
      signal: metaController.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ url: redirectUrl }),
    })
    if (!metaFetch.ok) return null
    const meta = await metaFetch.json()
    const title = typeof meta?.title === 'string' ? meta.title.trim() : ''
    const image = typeof meta?.image === 'string' ? meta.image : undefined
    if (!title) return null
    return { found: true, barcode, name: title.slice(0, 200), imageUrl: image, source: 'gs1' }
  } catch {
    return null
  } finally {
    clearTimeout(metaTimeout)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const rawBarcode: unknown = body?.barcode

    if (typeof rawBarcode !== 'string' || !/^\d{8,14}$/.test(rawBarcode)) {
      const miss: LookupResult = { found: false, barcode: typeof rawBarcode === 'string' ? rawBarcode : '', source: null }
      return new Response(JSON.stringify({ ...miss, error: 'Invalid barcode' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const barcode = rawBarcode

    for (const { host, source } of FACTS_HOSTS) {
      const hit = await queryOpenFacts(host, source, barcode)
      if (hit) {
        return new Response(JSON.stringify(hit), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const gs1 = await queryGs1DigitalLink(barcode)
    if (gs1) {
      return new Response(JSON.stringify(gs1), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const miss: LookupResult = { found: false, barcode, source: null }
    return new Response(JSON.stringify(miss), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('lookup-product-by-barcode error:', message)
    return new Response(JSON.stringify({ found: false, barcode: '', source: null, error: message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
