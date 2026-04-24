import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

/**
 * Parse the Verified-by-GS1 results page for a single GTIN lookup.
 *
 * The page is server-rendered HTML. When the GTIN is registered, the
 * response contains a green confirmation banner ("This number is
 * registered to …") and a product details table with rows for GTIN,
 * Brand name, Product description, Global product category, Net content,
 * Country of sale. When the GTIN is unknown, that confirmation banner
 * is absent.
 *
 * We key off the banner text as the positive signal and echo-check the
 * GTIN to guard against misleading matches. All individual field
 * parsers are best-effort — a missing row just omits that field rather
 * than rejecting the whole response.
 */
function extractVerifiedByGs1(html: string, expectedGtin: string): {
  found: boolean
  gtin?: string
  brand?: string
  description?: string
  category?: string
  volume?: string
  country?: string
  registrant?: string
} {
  // Positive signal: the green "registered to <company>" banner.
  // Allow both English and localised variants by also accepting the
  // neighbouring strong-tagged company name pattern.
  const registrant = html.match(/registered to[^<]*<[^>]*>([^<]{1,200})<\/[^>]+>/i)?.[1]
  const registrantText = registrant ? decodeEntities(registrant).trim() : undefined
  if (!registrantText) return { found: false }

  const fieldByLabel = (label: string): string | undefined => {
    // Matches table rows like `<th>LABEL</th><td>VALUE</td>`,
    // `<dt>LABEL</dt><dd>VALUE</dd>`, or div-based `<div>LABEL</div><div>VALUE</div>`.
    const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`<(?:th|dt)[^>]*>\\s*${labelEsc}\\s*<\\/(?:th|dt)>\\s*<(?:td|dd)[^>]*>([\\s\\S]{1,800}?)<\\/(?:td|dd)>`, 'i'),
      new RegExp(`${labelEsc}\\s*<\\/[^>]+>\\s*<[^>]+>([\\s\\S]{1,800}?)<\\/[^>]+>`, 'i'),
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m) {
        const text = stripTags(m[1])
        if (text && text.toLowerCase() !== 'unknown') return text
      }
    }
    return undefined
  }

  const gtin = fieldByLabel('GTIN')?.replace(/\D/g, '')
  // Echo check: the returned GTIN must match the caller's 14-digit form.
  // This prevents false positives if the page re-rendered against a
  // stale query or if a different row somehow leaked through.
  if (gtin && gtin.replace(/^0+/, '') !== expectedGtin.replace(/^0+/, '')) {
    return { found: false }
  }

  const brandRaw = fieldByLabel('Brand name')
  // "(en) Chikoroff" → strip the localisation prefix.
  const brand = brandRaw?.replace(/^\([a-z]{2}\)\s*/i, '').trim() || undefined

  const descRaw = fieldByLabel('Product description')
  const description = descRaw?.replace(/^\([a-z]{2}\)\s*/i, '').trim() || undefined

  const category = fieldByLabel('Global product category')?.replace(/^\d+\s+/, '').trim() || undefined

  const volume = fieldByLabel('Net content')?.trim() || undefined
  const country = fieldByLabel('Country of sale')?.trim() || undefined

  return {
    found: true,
    gtin,
    brand,
    description,
    category,
    volume,
    country,
    registrant: registrantText,
  }
}

function extractMeta(html: string, url: string) {
  // Truncate to first </head> occurrence to avoid searching full body
  const headEnd = html.toLowerCase().indexOf('</head>')
  const head = headEnd !== -1 ? html.slice(0, headEnd + 7) : html.slice(0, 50000)

  // og:title
  let title: string | undefined
  const ogTitle = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,500})["']/i)
    ?? head.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:title["']/i)
  if (ogTitle) {
    title = decodeEntities(ogTitle[1])
  } else {
    const titleTag = head.match(/<title[^>]*>([^<]{1,500})<\/title>/i)
    if (titleTag) title = decodeEntities(titleTag[1])
  }

  // og:description or meta description
  let description: string | undefined
  const ogDesc = head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,1000})["']/i)
    ?? head.match(/<meta[^>]+content=["']([^"']{1,1000})["'][^>]+property=["']og:description["']/i)
    ?? head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,1000})["']/i)
    ?? head.match(/<meta[^>]+content=["']([^"']{1,1000})["'][^>]+name=["']description["']/i)
  if (ogDesc) description = decodeEntities(ogDesc[1])

  // og:image
  let image: string | undefined
  const ogImage = head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,2000})["']/i)
    ?? head.match(/<meta[^>]+content=["']([^"']{1,2000})["'][^>]+property=["']og:image["']/i)
  if (ogImage) image = ogImage[1]

  // favicon: <link rel="icon"> or <link rel="shortcut icon">, resolved to absolute URL
  let favicon: string | undefined
  const faviconLink = head.match(/<link[^>]+rel=["'][^"']*(?:shortcut icon|icon)[^"']*["'][^>]+href=["']([^"']{1,2000})["']/i)
    ?? head.match(/<link[^>]+href=["']([^"']{1,2000})["'][^>]+rel=["'][^"']*(?:shortcut icon|icon)[^"']*["']/i)
  if (faviconLink) {
    try {
      favicon = new URL(faviconLink[1], url).toString()
    } catch {
      // ignore malformed href
    }
  }

  return { url, title, description, image, favicon }
}

/** Read up to maxBytes from a Response body. If stopAt is provided (e.g. '</head>'),
 *  streaming stops early after that marker is observed; otherwise the full body
 *  (up to maxBytes) is returned. */
async function readHtml(
  response: Response,
  opts: { maxBytes?: number; stopAt?: string } = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? 512 * 1024
  const stopAt = opts.stopAt ?? '</head>'
  const reader = response.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      totalBytes += value.length
      if (totalBytes >= maxBytes) break
      if (stopAt) {
        const partial = decoder.decode(value, { stream: true })
        if (partial.toLowerCase().includes(stopAt)) break
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return chunks.map((c) => decoder.decode(c, { stream: true })).join('')
}

/** Fetch HTML via ScrapingBee (handles antibot protection) */
async function fetchViaScrapingBee(
  url: string,
  apiKey: string,
  readOpts: { maxBytes?: number; stopAt?: string } = {},
): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const sbUrl = `https://app.scrapingbee.com/api/v1?api_key=${apiKey}&url=${encodeURIComponent(url)}&render_js=false`
    const response = await fetch(sbUrl, { signal: controller.signal })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await readHtml(response, readOpts)
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// Status codes that indicate antibot protection
const ANTIBOT_STATUSES = new Set([401, 403, 407, 429, 503])

/** Fetch HTML directly with browser-like User-Agent. Returns html or null on failure.
 *  Sets antiBotBlocked=true on the result object when a bot-protection status is detected. */
async function fetchDirect(
  url: string,
  readOpts: { maxBytes?: number; stopAt?: string } = {},
): Promise<{ html: string | null; antiBotBlocked: boolean }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
      },
    })
    if (ANTIBOT_STATUSES.has(response.status)) {
      return { html: null, antiBotBlocked: true }
    }
    if (!response.ok) return { html: null, antiBotBlocked: false }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return { html: null, antiBotBlocked: false }
    return { html: await readHtml(response, readOpts), antiBotBlocked: false }
  } catch {
    return { html: null, antiBotBlocked: false }
  } finally {
    clearTimeout(timeoutId)
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
    const { url, verifiedByGs1Gtin } = body
    const isVerifiedByGs1 =
      typeof verifiedByGs1Gtin === 'string' && /^\d{14}$/.test(verifiedByGs1Gtin)

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'Only http/https URLs are allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const targetUrl = parsedUrl.toString()

    // Verified-by-GS1 renders product data in the <body>, not the <head>,
    // so disable the usual early-stop-at-</head> streaming and read the
    // full (bounded) document.
    const readOpts = isVerifiedByGs1
      ? { maxBytes: 1024 * 1024, stopAt: '' }
      : {}

    // Primary: direct fetch
    const { html: directHtml, antiBotBlocked } = await fetchDirect(targetUrl, readOpts)
    let html: string | null = directHtml

    // Fallback to ScrapingBee when blocked by antibot protection or direct fetch failed
    if (!html && antiBotBlocked) {
      const scrapingBeeKey = Deno.env.get('SCRAPINGBEE_API_KEY')
      if (scrapingBeeKey) {
        html = await fetchViaScrapingBee(targetUrl, scrapingBeeKey, readOpts)
      }
    }

    if (!html) {
      return new Response(JSON.stringify({ error: 'Failed to fetch page' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const meta = extractMeta(html, targetUrl)
    const verifiedByGs1 = isVerifiedByGs1
      ? extractVerifiedByGs1(html, verifiedByGs1Gtin as string)
      : undefined

    return new Response(JSON.stringify({ ...meta, verifiedByGs1 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('fetch-meta error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 200, // Always 200 so CORS error doesn't mask the real error on client
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
