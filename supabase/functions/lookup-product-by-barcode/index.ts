import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const USER_AGENT = 'ShopAssist/1.9.5 (https://github.com/LastSkywalkerer/shop-assist)'

// GS1 Application Identifier `01` mandates a 14-digit GTIN; `id.gs1.org/01/<GTIN>`
// returns 404 for shorter inputs (e.g. raw EAN-13). Pad on the left with zeros.
function toGtin14(code: string): string {
  if (code.length >= 14) return code
  return code.padStart(14, '0')
}

// Canonical EAN-13 form: a 14-digit GTIN with a leading `0` trims down,
// 12-digit UPC-A gets a leading `0`, shorter inputs pass through.
function toCanonical(code: string): string {
  if (code.length === 14 && code.startsWith('0')) return code.slice(1)
  if (code.length === 12) return '0' + code
  return code
}

// Build the ordered set of GTIN length variants to try against a length-
// agnostic source like Open Food Facts: canonical EAN-13 first (best cache
// hit rate), GTIN-14 second (some entries are indexed that way), raw input
// last (already covered by the first two but kept for non-12/13/14 inputs).
function gtinVariants(code: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (!seen.has(v)) { seen.add(v); out.push(v) }
  }
  push(toCanonical(code))
  push(toGtin14(code))
  push(code)
  return out
}

// Mod-10 check digit — soft diagnostic so a mis-scan shows up in logs.
function isValidGtinChecksum(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false
  const digits = gtin.split('').map((d) => Number(d))
  const check = digits.pop() as number
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return ((10 - (sum % 10)) % 10) === check
}

type LookupSource = 'off' | 'obf' | 'opf' | 'vbg1' | 'gs1' | null

interface LookupResult {
  found: boolean
  barcode: string
  name?: string
  brand?: string
  category?: string
  /** Small thumbnail for inline preview. */
  imageUrl?: string
  /** Large original image — used for auto-attaching to the purchase. */
  imageLargeUrl?: string
  /** Quantity / package volume as a human string ("1 L", "500 g"). */
  volume?: string
  /** Generic product name; useful as a "variety" suggestion. */
  genericName?: string
  /** Comma-separated or array of retailer tags (often European). */
  stores?: string[]
  /** Normalized label slugs ("organic", "fair-trade", ...). */
  labels?: string[]
  /** Nutri-Score letter A-E. */
  nutriscoreGrade?: string
  /** NOVA processing group 1-4. */
  novaGroup?: number
  /** Canonical product page on the source service. */
  officialUrl?: string
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

function pickLocalized(p: Record<string, unknown>, key: string): string | undefined {
  const ru = p[`${key}_ru`]
  if (typeof ru === 'string' && ru.trim()) return ru.trim()
  const base = p[key]
  if (typeof base === 'string' && base.trim()) return base.trim()
  const en = p[`${key}_en`]
  if (typeof en === 'string' && en.trim()) return en.trim()
  return undefined
}

function cleanTag(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined
  return tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim() || undefined
}

async function queryOpenFacts(host: string, source: Exclude<LookupSource, null | 'gs1'>, barcode: string): Promise<LookupResult | null> {
  const fields = [
    'product_name', 'product_name_ru', 'product_name_en',
    'generic_name', 'generic_name_ru', 'generic_name_en',
    'brands',
    'categories_tags',
    'quantity',
    'labels_tags',
    'stores', 'stores_tags',
    'nutriscore_grade',
    'nova_group',
    'image_front_small_url', 'image_front_url',
  ].join(',')
  const url = `https://${host}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`
  const data = await fetchJson(url)
  if (!data || data.status !== 1 || !data.product) return null
  const p = data.product as Record<string, unknown>

  const name = pickLocalized(p, 'product_name')
  if (!name) return null

  const genericRaw = pickLocalized(p, 'generic_name')
  const genericName = genericRaw && genericRaw.toLowerCase() !== name.toLowerCase() ? genericRaw : undefined

  const brand = typeof p.brands === 'string' ? p.brands.split(',')[0]?.trim() || undefined : undefined

  const category = Array.isArray(p.categories_tags) && p.categories_tags.length > 0
    ? cleanTag(p.categories_tags[p.categories_tags.length - 1])
    : undefined

  const imageUrl = typeof p.image_front_small_url === 'string' ? p.image_front_small_url : undefined
  const imageLargeUrl = typeof p.image_front_url === 'string' ? p.image_front_url : undefined

  const volume = typeof p.quantity === 'string' && p.quantity.trim() ? p.quantity.trim() : undefined

  const labelsFromTags = Array.isArray(p.labels_tags)
    ? p.labels_tags.map(cleanTag).filter((v): v is string => !!v)
    : []
  const labels = labelsFromTags.length ? labelsFromTags.slice(0, 6) : undefined

  let stores: string[] | undefined
  if (Array.isArray(p.stores_tags) && p.stores_tags.length > 0) {
    stores = p.stores_tags.map(cleanTag).filter((v): v is string => !!v).slice(0, 5)
  } else if (typeof p.stores === 'string' && p.stores.trim()) {
    stores = p.stores.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5)
  }

  const nutriscoreGrade = typeof p.nutriscore_grade === 'string' && /^[a-e]$/i.test(p.nutriscore_grade)
    ? p.nutriscore_grade.toLowerCase()
    : undefined
  const novaGroup = typeof p.nova_group === 'number' && p.nova_group >= 1 && p.nova_group <= 4
    ? p.nova_group
    : undefined

  const officialUrl = `https://${host}/product/${encodeURIComponent(barcode)}`

  return {
    found: true,
    barcode,
    name,
    brand,
    category,
    imageUrl,
    imageLargeUrl,
    volume,
    genericName,
    stores,
    labels,
    nutriscoreGrade,
    novaGroup,
    officialUrl,
    source,
  }
}

// Verified-by-GS1: the global GS1 product registry. Accurate brand-authored
// data exists here for many GTINs that are missing from Open Food Facts and
// from the Digital Link resolver (notably Russian-prefix 460-469 items).
// The public JSON API is member-only, so we scrape the HTML results page via
// the fetch-meta edge function which handles antibot (ScrapingBee).
async function queryVerifiedByGs1(barcode: string): Promise<LookupResult | null> {
  const gtin14 = toGtin14(barcode)
  const base = Deno.env.get('SUPABASE_URL')
  // Prefer service-role for edge-to-edge calls; fall back to anon only if it's
  // all we have. Both work, but service-role avoids edge cases where fetch-meta
  // has JWT verification tightened.
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')
  if (!base || !key) {
    console.warn(`vbg1 ${gtin14}: missing env (base=${!!base} key=${!!key}) — skipping`)
    return null
  }

  const resultsUrl = `https://www.gs1.org/services/verified-by-gs1/results?gtin=${gtin14}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(`${base}/functions/v1/fetch-meta`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ url: resultsUrl, verifiedByGs1Gtin: gtin14 }),
    })
    if (!res.ok) {
      console.warn(`vbg1 ${gtin14}: fetch-meta HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    if (!data || typeof data !== 'object') {
      console.warn(`vbg1 ${gtin14}: fetch-meta returned non-object`)
      return null
    }
    if (data.error) {
      // fetch-meta couldn't load the page (antibot, no ScrapingBee key, etc).
      console.warn(`vbg1 ${gtin14}: fetch-meta error="${data.error}"`)
      return null
    }
    const vbg = data.verifiedByGs1
    if (!vbg) {
      // Legacy fetch-meta deploy without verifiedByGs1 support.
      console.warn(`vbg1 ${gtin14}: fetch-meta response lacks verifiedByGs1 field (is it deployed?)`)
      return null
    }
    if (!vbg.found) {
      console.log(`vbg1 ${gtin14}: parser reported not found (page has no product-container or GTIN mismatch)`)
      return null
    }

    // Prefer explicit Product description over OG title (the latter is usually
    // "Verified by GS1 Results | GS1" — the page template's static title).
    const name = (vbg.description || vbg.brand) as string | undefined
    if (!name) {
      console.warn(`vbg1 ${gtin14}: parser found page but no usable name`)
      return null
    }

    return {
      found: true,
      barcode,
      name: name.slice(0, 200),
      brand: vbg.brand,
      category: vbg.category,
      volume: vbg.volume,
      officialUrl: resultsUrl,
      source: 'vbg1',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`vbg1 ${gtin14}: exception "${msg}"`)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Best-effort fallback: GS1 Digital Link resolver redirects a GTIN to a brand-owner URL.
// If that URL resolves to an HTML page, delegate to fetch-meta to extract OG title + image.
async function queryGs1DigitalLink(barcode: string): Promise<LookupResult | null> {
  // AI `01` requires exactly 14 digits — without this pad, a 13-digit EAN-13
  // always returns 404 and the fallback silently fails.
  const gtin14 = toGtin14(barcode)
  let redirectUrl: string | null = null
  const resolveController = new AbortController()
  const resolveTimeout = setTimeout(() => resolveController.abort(), 5000)
  try {
    // GET + manual-redirect: some brand-owner servers behind the resolver
    // don't honor HEAD (return 405 or strip Location). We only read headers,
    // so the body is never consumed.
    const res = await fetch(`https://id.gs1.org/01/${encodeURIComponent(gtin14)}`, {
      method: 'GET',
      redirect: 'manual',
      signal: resolveController.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc && /^https?:\/\//i.test(loc) && !loc.includes('id.gs1.org')) {
      redirectUrl = loc
    }
    try { res.body?.cancel() } catch { /* best-effort */ }
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
    if (!isValidGtinChecksum(barcode)) {
      console.warn(`lookup ${barcode}: invalid GTIN check digit (continuing anyway)`)
    }

    const variants = gtinVariants(barcode)

    // Open*Facts is length-agnostic but returns a specific row per stored
    // length. Try canonical form first, then GTIN-14, to catch both.
    for (const { host, source } of FACTS_HOSTS) {
      for (const variant of variants) {
        const hit = await queryOpenFacts(host, source, variant)
        console.log(`lookup ${barcode}[${variant}] @ ${source}: ${hit ? 'HIT' : 'miss'}`)
        if (hit) {
          // Always return the caller's original barcode string so the client
          // can match its local DB row without caring about length variants.
          return new Response(JSON.stringify({ ...hit, barcode }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    const vbg1 = await queryVerifiedByGs1(barcode)
    console.log(`lookup ${barcode} @ vbg1: ${vbg1 ? 'HIT' : 'miss'}`)
    if (vbg1) {
      return new Response(JSON.stringify({ ...vbg1, barcode }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const gs1 = await queryGs1DigitalLink(barcode)
    console.log(`lookup ${barcode} @ gs1: ${gs1 ? 'HIT' : 'miss'}`)
    if (gs1) {
      return new Response(JSON.stringify({ ...gs1, barcode }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`lookup ${barcode}: not found in any source`)
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
