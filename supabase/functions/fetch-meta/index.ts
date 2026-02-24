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

/** Read up to maxBytes from a Response body, stopping early after </head> */
async function readHtml(response: Response, maxBytes = 512 * 1024): Promise<string> {
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
      const partial = decoder.decode(value, { stream: true })
      if (partial.toLowerCase().includes('</head>')) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return chunks.map((c) => decoder.decode(c, { stream: true })).join('')
}

/** Fetch HTML via ScrapingBee (handles antibot protection) */
async function fetchViaScrapingBee(url: string, apiKey: string): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const sbUrl = `https://app.scrapingbee.com/api/v1?api_key=${apiKey}&url=${encodeURIComponent(url)}&render_js=false`
    const response = await fetch(sbUrl, { signal: controller.signal })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await readHtml(response)
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Fetch HTML directly with browser-like User-Agent */
async function fetchDirect(url: string): Promise<string | null> {
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
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await readHtml(response)
  } catch {
    return null
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
    const { url } = body

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

    // Primary: ScrapingBee (handles antibot protection)
    const scrapingBeeKey = Deno.env.get('SCRAPINGBEE_API_KEY')
    let html: string | null = null

    if (scrapingBeeKey) {
      html = await fetchViaScrapingBee(targetUrl, scrapingBeeKey)
    }

    // Fallback: direct fetch
    if (!html) {
      html = await fetchDirect(targetUrl)
    }

    if (!html) {
      return new Response(JSON.stringify({ error: 'Failed to fetch page' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const meta = extractMeta(html, targetUrl)

    return new Response(JSON.stringify(meta), {
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
