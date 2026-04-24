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
 * Markup reference (saved page for GTIN 4607013795945, captured 2026-04):
 *   <div id="product-container" class="verified-gs1-company results-gtin …">
 *     …
 *     This number is registered to <strong>ООО "НоваПродукт АГ"</strong>.
 *     …
 *     <div … id="productInformation" role="tabpanel">
 *       <h3>Напиток из цикория "Чикорофф" по восточноу</h3>
 *       <table class="company">
 *         <tr><td>GTIN</td><td><strong>04607013795945</strong></td></tr>
 *         <tr><td rowspan="1">Brand name</td><td class="value"><strong>(en) Chikoroff</strong></td></tr>
 *         <tr><td rowspan="1">Product description</td><td class="value"><strong>(ru) …</strong></td></tr>
 *         <tr><td>Product image URL</td><td class="wrapper-unknown"><strong>Unknown</strong></td></tr>
 *         <tr><td>Global product category</td><td><strong>10006311 Coffee Substitutes – Soluble Instant</strong></td></tr>
 *         <tr><td>Net content</td><td><strong>100 Gram</strong></td></tr>
 *         <tr><td>Country of sale</td><td><strong>Russian Federation (the)</strong></td></tr>
 *       </table>
 *
 * Positive signal: presence of `id="product-container"` (only emitted when
 * the GTIN resolves to a registered product). We additionally echo-check
 * the rendered GTIN against the caller's input to guard against partial
 * page renders or stale caches. Individual field parsers are best-effort —
 * a missing row just omits that field rather than rejecting the whole row.
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
  // Scope all subsequent parsing to the product container — the page also
  // contains site-chrome sections with <h3> and tables that would otherwise
  // produce false matches.
  const containerMatch = html.match(/<div\s+id=["']product-container["'][^>]*>([\s\S]*?)<\/main>/i)
    ?? html.match(/<div\s+id=["']product-container["'][^>]*>([\s\S]+)$/i)
  if (!containerMatch) return { found: false }
  const container = containerMatch[1]

  // Optional but informative: pull the registrant company from the green banner.
  // The banner text "This number is registered to <strong>NAME</strong>" appears
  // before the tabs, so it lives inside the container slice.
  const registrantMatch = container.match(/registered to\s*<strong[^>]*>([\s\S]{1,300}?)<\/strong>/i)
  const registrant = registrantMatch ? decodeEntities(stripTags(registrantMatch[1])) : undefined

  // Product Information tab pane — scope title and table extraction here so
  // that the Company tab's <h3> and table don't shadow product fields.
  const productPaneMatch = container.match(/id=["']productInformation["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]*id=["']companyInformation["']/i)
    ?? container.match(/id=["']productInformation["'][^>]*>([\s\S]+)$/i)
  const productPane = productPaneMatch ? productPaneMatch[1] : container

  // Product title — the first <h3> inside the productInformation pane.
  const titleMatch = productPane.match(/<h3[^>]*>([\s\S]{1,500}?)<\/h3>/i)
  const titleText = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : undefined

  const fieldByLabel = (label: string): string | undefined => {
    const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match a <tr> row whose first <td> contains exactly the label and whose
    // following <td> holds the value (typically wrapped in <strong>). The
    // value cell may carry class="value" or class="wrapper-unknown".
    const rowRe = new RegExp(
      `<tr[^>]*>\\s*<td[^>]*>\\s*${labelEsc}\\s*<\\/td>[\\s\\S]{0,2000}?<td[^>]*>([\\s\\S]{1,800}?)<\\/td>`,
      'i',
    )
    const m = productPane.match(rowRe)
    if (!m) return undefined
    const text = decodeEntities(stripTags(m[1]))
    if (!text || text.toLowerCase() === 'unknown') return undefined
    return text
  }

  const gtinRendered = fieldByLabel('GTIN')?.replace(/\D/g, '')
  // Echo check: rendered GTIN (with leading zero, GTIN-14) must match the
  // caller's expected GTIN-14 modulo leading zeros. Mismatch ⇒ reject the
  // whole record so we don't return wrong-product data.
  if (gtinRendered && gtinRendered.replace(/^0+/, '') !== expectedGtin.replace(/^0+/, '')) {
    return { found: false }
  }

  const stripLocale = (s: string | undefined) =>
    s ? s.replace(/^\(\s*[a-z]{2}\s*\)\s*/i, '').trim() || undefined : undefined

  const brand = stripLocale(fieldByLabel('Brand name'))
  const description = stripLocale(fieldByLabel('Product description'))
  // GPC categories arrive as "<8-digit code> <Category Name>"; drop the code.
  const category = fieldByLabel('Global product category')?.replace(/^\d{6,10}\s+/, '').trim() || undefined
  const volume = fieldByLabel('Net content')
  const country = fieldByLabel('Country of sale')

  // Use the H3 title as a fallback description if the localised row is
  // missing or shorter than the title. The H3 is what GS1 surfaces as the
  // canonical product label on the page.
  const finalDescription = description || titleText

  return {
    found: true,
    gtin: gtinRendered,
    brand,
    description: finalDescription,
    category,
    volume,
    country,
    registrant,
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
    const tag = isVerifiedByGs1 ? `vbg1 ${verifiedByGs1Gtin}` : 'fetch-meta'

    // Verified-by-GS1 renders product data in the <body>, not the <head>,
    // so disable the usual early-stop-at-</head> streaming and read the
    // full (bounded) document.
    const readOpts = isVerifiedByGs1
      ? { maxBytes: 1024 * 1024, stopAt: '' }
      : {}

    // Primary: direct fetch
    const { html: directHtml, antiBotBlocked } = await fetchDirect(targetUrl, readOpts)
    let html: string | null = directHtml
    let via: 'direct' | 'scrapingbee' | null = directHtml ? 'direct' : null

    // Fallback to ScrapingBee when blocked by antibot protection or direct fetch failed
    if (!html && antiBotBlocked) {
      const scrapingBeeKey = Deno.env.get('SCRAPINGBEE_API_KEY')
      if (scrapingBeeKey) {
        html = await fetchViaScrapingBee(targetUrl, scrapingBeeKey, readOpts)
        if (html) via = 'scrapingbee'
      } else {
        console.warn(`${tag}: direct fetch blocked (antibot) and SCRAPINGBEE_API_KEY is not set`)
      }
    }

    if (!html) {
      console.warn(`${tag}: failed to fetch page (antiBotBlocked=${antiBotBlocked})`)
      return new Response(JSON.stringify({ error: 'Failed to fetch page', antiBotBlocked }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const meta = extractMeta(html, targetUrl)
    const verifiedByGs1 = isVerifiedByGs1
      ? extractVerifiedByGs1(html, verifiedByGs1Gtin as string)
      : undefined

    if (isVerifiedByGs1) {
      // Diagnostic: page fetched but parser failed to find a product. Surface
      // enough detail in the logs to tell whether the page was blocked,
      // returned a captcha shell, or legitimately lists no product.
      const hasContainer = /id=["']product-container["']/i.test(html)
      const hasBanner = /registered to/i.test(html)
      console.log(
        `${tag}: via=${via} htmlLen=${html.length} productContainer=${hasContainer} registeredBanner=${hasBanner} parserFound=${verifiedByGs1?.found ?? false}`,
      )
    }

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
