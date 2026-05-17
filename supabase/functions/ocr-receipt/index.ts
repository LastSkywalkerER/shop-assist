import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const LIMIT_PER_MINUTE = 20
const LIMIT_PER_DAY = 200

const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'google/gemini-2.5-flash':            { in: 0.00030, out: 0.00250 },
  'google/gemini-2.5-flash-lite':       { in: 0.00010, out: 0.00040 },
  'google/gemini-2.5-pro':              { in: 0.00125, out: 0.01000 },
  'qwen/qwen3-vl-30b-a3b-instruct':     { in: 0.00013, out: 0.00052 },
  'qwen/qwen3-vl-235b-a22b':            { in: 0.00020, out: 0.00088 },
  'openai/gpt-5-mini':                  { in: 0.00025, out: 0.00200 },
  'openai/gpt-4.1-mini':                { in: 0.00040, out: 0.00160 },
}

type Pass = 'extract' | 'validate' | 'escalate'

interface CatalogExpense {
  label: string | null
  category: string | null
  store: string | null
  date: string | null
  total: number | null
  items: string[]
}

interface Catalog {
  productNames?: string[]
  categoryNames?: string[]
  storeNames?: string[]
  expenseLabels?: string[]
  recentExpenses?: CatalogExpense[]
}

interface RequestBody {
  pass: Pass
  model: string
  imageBase64?: string
  imageMimeType?: string
  previousJson?: unknown
  currency?: string
  catalog?: Catalog
}

interface ReceiptItemPayload {
  name: string
  amount: number
  packageVolume?: string
  manufacturer?: string
}

interface ItemMatch {
  itemIndex: number
  productName: string | null
  confidence: number
}

interface ReceiptMatches {
  items: ItemMatch[]
  expenseLabel: string | null
  expenseCategoryName: string | null
  expenseLabelConfidence: number
  duplicateDate: string | null
  duplicateTotal: number | null
  duplicateStoreName: string | null
  duplicateConfidence: number
}

interface ReceiptPayload {
  store?: { name: string; address?: string }
  date?: string
  currency: string
  total?: number
  items: ReceiptItemPayload[]
  confidence: number
  needsEscalation: boolean
  matches?: ReceiptMatches | null
}

const RECEIPT_JSON_SCHEMA = {
  name: 'receipt',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      store: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          address: { type: ['string', 'null'] },
        },
        required: ['name', 'address'],
      },
      date: { type: ['string', 'null'], description: 'ISO date (YYYY-MM-DD), if visible on receipt' },
      currency: { type: 'string', description: 'ISO 4217 code such as BYN, RUB, USD' },
      total: { type: ['number', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            packageVolume: { type: ['string', 'null'] },
            manufacturer: { type: ['string', 'null'] },
          },
          required: ['name', 'amount', 'packageVolume', 'manufacturer'],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      needsEscalation: { type: 'boolean' },
      matches: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                itemIndex: { type: 'integer', minimum: 0 },
                productName: { type: ['string', 'null'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['itemIndex', 'productName', 'confidence'],
            },
          },
          expenseLabel: { type: ['string', 'null'] },
          expenseCategoryName: { type: ['string', 'null'] },
          expenseLabelConfidence: { type: 'number', minimum: 0, maximum: 1 },
          duplicateDate: { type: ['string', 'null'] },
          duplicateTotal: { type: ['number', 'null'] },
          duplicateStoreName: { type: ['string', 'null'] },
          duplicateConfidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['items', 'expenseLabel', 'expenseCategoryName', 'expenseLabelConfidence', 'duplicateDate', 'duplicateTotal', 'duplicateStoreName', 'duplicateConfidence'],
      },
    },
    required: ['store', 'date', 'currency', 'total', 'items', 'confidence', 'needsEscalation', 'matches'],
  },
}

const EXTRACT_PROMPT = `Ты — парсер кассовых чеков. На изображении чек на русском языке (возможны белорусские/украинские слова).
Извлеки строго в JSON:
- store.name — название магазина или сети
- store.address — ПОЛНЫЙ адрес покупки одной строкой. Если магазин в ТРЦ/ТЦ/МФК/аутлете/рынке — укажи название ТЦ перед уличным адресом (например: "ТРЦ Палаццо, г. Минск, ул. Тимирязева, 74, корпус А"). Не теряй город, улицу, дом, корпус.
- date — YYYY-MM-DD
- currency — BYN/RUB/USD/EUR и т.п. (по умолчанию BYN)
- total — итоговая сумма
- items[] — позиции: name (исправь смешанные o/о, a/а, c/с в кириллице), amount (сумма за позицию), packageVolume и manufacturer
- confidence — 0..1
- needsEscalation — true если плохо распознали

Опциональные поля (store, date, total, packageVolume, manufacturer, address) — если не видишь, пиши null, не пропускай ключ. matches всегда null на этом проходе.
Не выдумывай позиции. Не включай в items сервисные строки (итого, скидка, нал/безнал, НДС).`

const VALIDATE_PROMPT = `Ты валидатор и подбиратор связей для JSON-чека. Тебе дают:
1) JSON-чек после OCR (поле receipt);
2) catalog с НАЗВАНИЯМИ из пользовательской базы:
   - productNames: уникальные имена существующих товаров
   - categoryNames: уникальные имена категорий расходов
   - storeNames: уникальные имена магазинов
   - expenseLabels: уникальные имена которыми пользователь раньше называл расходы
   - recentExpenses[]: последние расходы со связкой label↔items↔category — здесь видна привычка.

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - сумма items[].amount ≈ total (допуск 1%); если total нет — посчитай.
   - Кириллица: латинские o/a/c/p/x/e/H/B → русские внутри слов ("Moлоko" → "Молоко").
   - Название магазина — торговое имя без юр-формы.
   - confidence пересчитай; плохой чек — needsEscalation=true.

B) Заполни matches возвращая ИМЕНА (строки) из каталога, не выдумывая:
   matches.items: ДЛЯ КАЖДОЙ позиции по itemIndex (0-based) выбери productName РОВНО из catalog.productNames — тот же товар. Сравнивай название + категорию + производителя + объём. confidence ≥ 0.85 только при явном совпадении. Иначе productName=null, confidence=0.

   matches.expenseLabel, expenseCategoryName, expenseLabelConfidence:
     - В recentExpenses смотри ОБЯЗАТЕЛЬНО на items[] каждого расхода. Если в чеке есть похожие позиции (футболка ≈ футболка/майка/одежда; колбаса ≈ мясо и т.д.) — бери label И category из такого расхода. Это привычка пользователя.
     - Иначе — categoryName из catalog.categoryNames по типу товаров + expenseLabel из catalog.expenseLabels или сгенерируй короткое (1-3 слова).
     - expenseCategoryName ДОЛЖЕН быть РОВНО из catalog.categoryNames (или null).

   matches.duplicateDate/duplicateTotal/duplicateStoreName/duplicateConfidence:
     - Дубликат: тот же магазин + дата ±1 день + |total - expense.total| ≤ 1%. Сравнивай с recentExpenses.
     - Нашёл — заполни date/total/storeName РОВНО из найденного, confidence > 0.8. Иначе null и 0.

ВАЖНО: productName / expenseCategoryName / duplicateStoreName брать ИЗ КАТАЛОГА буква в букву, либо null. Не придумывай новых (кроме expenseLabel если ничего не подошло).`

function base64Bytes(b64: string): number {
  const padding = (b64.match(/=+$/)?.[0]?.length ?? 0)
  return Math.floor((b64.length * 3) / 4) - padding
}

function estimateCost(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number | null {
  if (!usage) return null
  const price = MODEL_PRICES[model]
  if (!price) return null
  const inT = (usage.prompt_tokens ?? 0) / 1000
  const outT = (usage.completion_tokens ?? 0) / 1000
  return +(inT * price.in + outT * price.out).toFixed(6)
}

// -----------------------------------------------------------------------------
// Structured logger. Every line begins with [ocr-receipt:<reqId>:<step>]
// so a single request can be grepped out of the Supabase function log stream.
// -----------------------------------------------------------------------------
class Log {
  readonly reqId: string
  readonly t0: number
  constructor(reqId: string) {
    this.reqId = reqId
    this.t0 = Date.now()
  }
  private prefix(step: string): string {
    const dt = Date.now() - this.t0
    return `[ocr-receipt:${this.reqId}:${step}:+${dt}ms]`
  }
  step(step: string, data?: unknown): void {
    if (data === undefined) {
      console.log(this.prefix(step))
    } else if (typeof data === 'string') {
      console.log(this.prefix(step), data)
    } else {
      try {
        console.log(this.prefix(step), JSON.stringify(data))
      } catch {
        console.log(this.prefix(step), String(data))
      }
    }
  }
  /** Log a multi-line block — useful for prompts and catalogs we want to read raw. */
  block(step: string, label: string, body: string): void {
    const head = this.prefix(step)
    console.log(`${head} ${label} (length=${body.length}):\n${body}\n${head} /${label}`)
  }
  warn(step: string, data?: unknown): void {
    if (data === undefined) console.warn(this.prefix(step))
    else console.warn(this.prefix(step), typeof data === 'string' ? data : JSON.stringify(data))
  }
  error(step: string, data?: unknown): void {
    if (data === undefined) console.error(this.prefix(step))
    else console.error(this.prefix(step), typeof data === 'string' ? data : JSON.stringify(data))
  }
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function catalogStats(catalog: Catalog): Record<string, number> {
  return {
    productNames: catalog.productNames?.length ?? 0,
    categoryNames: catalog.categoryNames?.length ?? 0,
    storeNames: catalog.storeNames?.length ?? 0,
    expenseLabels: catalog.expenseLabels?.length ?? 0,
    recentExpenses: catalog.recentExpenses?.length ?? 0,
    recentExpenses_with_items: (catalog.recentExpenses ?? []).filter((e) => e.items && e.items.length).length,
  }
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: unknown[],
  log: Log,
): Promise<{ data: ReceiptPayload; rawUsage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const reqBody = {
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: RECEIPT_JSON_SCHEMA },
  }

  // Log the outgoing request, but redact base64 image payloads (they would
  // dominate the log line). For text-only validate pass this is the full
  // assembled prompt verbatim.
  log.step('openrouter:request_summary', {
    model,
    messages_count: messages.length,
    response_format: 'json_schema/strict',
  })
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as { role?: string; content?: unknown }
    if (typeof msg.content === 'string') {
      log.block('openrouter:msg', `message[${i}] text`, msg.content)
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content as Array<{ type?: string; text?: string; image_url?: { url?: string } }>
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]
        if (part.type === 'text' && typeof part.text === 'string') {
          log.block('openrouter:msg', `message[${i}].content[${p}] text`, part.text)
        } else if (part.type === 'image_url') {
          const url = part.image_url?.url ?? ''
          const head = url.slice(0, url.indexOf(',') + 1) || '<no-prefix>'
          log.step('openrouter:msg', { idx: `${i}.${p}`, type: 'image_url', prefix: head, payload_bytes: Math.max(0, url.length - head.length) })
        }
      }
    }
  }

  const t = Date.now()
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/LastSkywalkerer/shop-assist',
      'X-Title': 'ShopAssist Receipt OCR',
    },
    body: JSON.stringify(reqBody),
  })
  log.step('openrouter:response_meta', { http: res.status, ms: Date.now() - t })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    log.error('openrouter:http_error', { status: res.status, body: text.slice(0, 1000) })
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  const body = await res.json()
  log.step('openrouter:usage', body?.usage ?? null)

  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    log.error('openrouter:bad_content', { content_type: typeof content })
    throw new Error('OpenRouter response missing content')
  }
  log.block('openrouter:content', 'raw assistant content', content)

  let parsed: ReceiptPayload
  try {
    parsed = JSON.parse(content) as ReceiptPayload
  } catch {
    log.warn('openrouter:json_parse_fallback', 'strict JSON.parse failed; trying greedy match')
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('OpenRouter returned non-JSON content')
    parsed = JSON.parse(match[0]) as ReceiptPayload
  }

  if (!Array.isArray(parsed.items)) parsed.items = []
  if (typeof parsed.currency !== 'string' || !parsed.currency) parsed.currency = 'BYN'
  if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5
  if (typeof parsed.needsEscalation !== 'boolean') parsed.needsEscalation = false
  if (parsed.matches && typeof parsed.matches === 'object') {
    const m = parsed.matches
    if (!Array.isArray(m.items)) m.items = []
    if (typeof m.expenseLabelConfidence !== 'number') m.expenseLabelConfidence = 0
    if (typeof m.duplicateConfidence !== 'number') m.duplicateConfidence = 0
    if (m.expenseLabel === undefined) m.expenseLabel = null
    if (m.expenseCategoryName === undefined) m.expenseCategoryName = null
    if (m.duplicateDate === undefined) m.duplicateDate = null
    if (m.duplicateTotal === undefined) m.duplicateTotal = null
    if (m.duplicateStoreName === undefined) m.duplicateStoreName = null
  }

  log.step('openrouter:parsed_summary', {
    items: parsed.items.length,
    confidence: parsed.confidence,
    needsEscalation: parsed.needsEscalation,
    has_matches: !!parsed.matches,
    match_items: parsed.matches?.items?.length ?? 0,
    expenseLabel: parsed.matches?.expenseLabel ?? null,
    expenseCategoryName: parsed.matches?.expenseCategoryName ?? null,
    expenseLabelConfidence: parsed.matches?.expenseLabelConfidence ?? 0,
    duplicateConfidence: parsed.matches?.duplicateConfidence ?? 0,
  })
  log.block('openrouter:parsed_full', 'normalized payload', JSON.stringify(parsed, null, 2))

  return { data: parsed, rawUsage: body?.usage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const log = new Log(shortId())
  log.step('request:start', { method: req.method, url: req.url })

  if (req.method !== 'POST') {
    log.warn('request:method_not_allowed', { method: req.method })
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
  log.step('env:check', {
    has_supabase_url: !!supabaseUrl,
    has_service_key: !!serviceKey,
    has_openrouter_key: !!openrouterKey,
  })
  if (!supabaseUrl || !serviceKey || !openrouterKey) {
    log.error('env:missing')
    return new Response(JSON.stringify({ ok: false, error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    log.warn('auth:missing_bearer')
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.slice(7)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData?.user) {
    log.warn('auth:invalid_token', { error: authError?.message ?? null })
    return new Response(JSON.stringify({ ok: false, error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  log.step('auth:ok', { auth_user_id: authData.user.id, email: authData.user.email })

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    log.warn('user_lookup:failed', { error: userErr?.message ?? null, found: !!userRow })
    return new Response(JSON.stringify({ ok: false, error: 'User not found' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userId = userRow.id as string

  let roomId: string | null = null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    roomId = payload?.user_metadata?.room_id ?? null
  } catch { /* ignore */ }
  log.step('jwt:metadata', { user_id: userId, room_id: roomId })

  const nowIso = new Date().toISOString()
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [{ count: perMin }, { count: perDay }] = await Promise.all([
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', minuteAgo),
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', dayAgo),
  ])
  log.step('rate_limit:check', { perMinute: perMin ?? 0, perDay: perDay ?? 0, limitMinute: LIMIT_PER_MINUTE, limitDay: LIMIT_PER_DAY })
  if ((perMin ?? 0) >= LIMIT_PER_MINUTE) {
    log.warn('rate_limit:hit', { scope: 'minute' })
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'minute' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if ((perDay ?? 0) >= LIMIT_PER_DAY) {
    log.warn('rate_limit:hit', { scope: 'day' })
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'day' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch (err) {
    log.error('body:invalid_json', { error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  log.step('body:received', {
    pass: body?.pass ?? null,
    model: body?.model ?? null,
    has_image: !!body?.imageBase64,
    image_base64_length: body?.imageBase64?.length ?? 0,
    image_mime: body?.imageMimeType ?? null,
    has_previous_json: !!body?.previousJson,
    has_catalog: !!body?.catalog,
    currency_hint: body?.currency ?? null,
  })

  if (!body || (body.pass !== 'extract' && body.pass !== 'validate' && body.pass !== 'escalate')) {
    log.warn('body:invalid_pass', { pass: body?.pass })
    return new Response(JSON.stringify({ ok: false, error: 'Invalid pass' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (typeof body.model !== 'string' || !body.model) {
    log.warn('body:missing_model')
    return new Response(JSON.stringify({ ok: false, error: 'Missing model' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let messages: unknown[]

  if (body.pass === 'extract' || body.pass === 'escalate') {
    if (!body.imageBase64) {
      log.warn('prep:missing_image')
      return new Response(JSON.stringify({ ok: false, error: 'Missing imageBase64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const imageBytes = base64Bytes(body.imageBase64)
    log.step('prep:image', { decoded_bytes: imageBytes, base64_chars: body.imageBase64.length, mime_in: body.imageMimeType ?? null })
    if (imageBytes > 6 * 1024 * 1024) {
      log.warn('prep:image_too_large', { decoded_bytes: imageBytes })
      return new Response(JSON.stringify({ ok: false, error: 'Image too large (≤6 MB after base64 decode)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mime = body.imageMimeType && /^image\/(jpeg|png|webp)$/.test(body.imageMimeType) ? body.imageMimeType : 'image/jpeg'
    const promptText = EXTRACT_PROMPT + (body.currency ? `\n\nВалюта по умолчанию: ${body.currency}.` : '')
    log.block('prep:extract_prompt', 'EXTRACT_PROMPT (with currency hint)', promptText)
    messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${body.imageBase64}` } },
        { type: 'text', text: promptText },
      ],
    }]
  } else {
    if (!body.previousJson) {
      log.warn('prep:missing_previous_json')
      return new Response(JSON.stringify({ ok: false, error: 'Missing previousJson' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const catalog = body.catalog ?? {}
    const stats = catalogStats(catalog)
    log.step('prep:catalog_stats', stats)
    if (catalog.productNames) log.step('prep:catalog_productNames_sample', catalog.productNames.slice(0, 20))
    if (catalog.categoryNames) log.step('prep:catalog_categoryNames', catalog.categoryNames)
    if (catalog.storeNames) log.step('prep:catalog_storeNames', catalog.storeNames)
    if (catalog.expenseLabels) log.step('prep:catalog_expenseLabels', catalog.expenseLabels)
    if (catalog.recentExpenses) log.block('prep:catalog_recentExpenses', 'recentExpenses', JSON.stringify(catalog.recentExpenses, null, 2))

    const receiptStr = JSON.stringify(body.previousJson, null, 2)
    const catalogStr = JSON.stringify(catalog, null, 2)
    log.block('prep:validate_receipt', 'receipt (from extract)', receiptStr)
    log.block('prep:validate_catalog', 'catalog (full)', catalogStr)

    const promptText = VALIDATE_PROMPT
      + '\n\nreceipt:\n' + JSON.stringify(body.previousJson)
      + '\n\ncatalog:\n' + JSON.stringify(catalog)
    log.step('prep:validate_prompt_size', { total_chars: promptText.length, approx_tokens: Math.ceil(promptText.length / 4) })
    log.block('prep:validate_prompt', 'VALIDATE prompt (final user message)', promptText)

    messages = [{ role: 'user', content: promptText }]
  }

  let result: { data: ReceiptPayload; rawUsage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    log.step('openrouter:call', { pass: body.pass, model: body.model })
    result = await callOpenRouter(openrouterKey, body.model, messages, log)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OpenRouter error'
    log.error('openrouter:exception', { pass: body.pass, model: body.model, error: msg })
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const cost = estimateCost(body.model, result.rawUsage)
  log.step('cost:estimate', { model: body.model, cost_usd: cost, usage: result.rawUsage ?? null })

  const { error: insertErr } = await supabase.from('ai_usage_log').insert({
    user_id: userId,
    room_id: roomId,
    function_name: 'ocr-receipt',
    model: body.model,
    pass: body.pass,
    cost_usd: cost,
    created_at: nowIso,
  })
  if (insertErr) {
    log.warn('usage_log:insert_failed', { error: insertErr.message })
  } else {
    log.step('usage_log:inserted')
  }

  log.step('request:done', { ok: true, pass: body.pass, model: body.model, cost_usd: cost })

  return new Response(JSON.stringify({ ok: true, json: result.data, costUsd: cost }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
