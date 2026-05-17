import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Per-user rate limits. The Edge runs against a small Postgres count so these
// must stay cheap; 20/min is far above the natural user rhythm of scanning a
// physical receipt and still blocks a runaway client loop.
const LIMIT_PER_MINUTE = 20
const LIMIT_PER_DAY = 200

// Approximate OpenRouter list prices ($/1K tokens) for cost logging. Kept in
// sync with src/lib/ai/models.ts on the client. Exact billing comes from the
// `usage` field when the provider returns it; this table is the fallback.
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

interface CatalogProduct { id: string; name: string; category?: string | null }
interface CatalogStore { id: string; name: string }
interface CatalogCategory { id: string; name: string }
interface CatalogExpense {
  id: string
  name?: string | null
  category?: string | null
  store?: string | null
  date?: string | null
  total?: number | null
  /** Up to ~5 receipt item names from this expense, so the model can
   * recognize that a past expense titled "Одежда" actually contained a
   * t-shirt etc. */
  items?: string[]
}
interface Catalog {
  products?: CatalogProduct[]
  categories?: CatalogCategory[]
  stores?: CatalogStore[]
  expenses?: CatalogExpense[]
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
  productId: string | null
  confidence: number
}

interface ReceiptMatches {
  items: ItemMatch[]
  expenseName: string | null
  expenseCategoryId: string | null
  expenseLabelConfidence: number
  existingExpenseId: string | null
  existingExpenseConfidence: number
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

// OpenAI strict mode (json_schema) requires every key listed under `properties`
// to also appear in `required` for ANY object subschema — including object
// variants of a nullable union. Optional fields are expressed by widening the
// type to include 'null'. Skipping a key in `required` triggers HTTP 400 from
// providers that enforce strict (GPT-5/4.1, Anthropic via OpenRouter).
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
                productId: { type: ['string', 'null'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['itemIndex', 'productId', 'confidence'],
            },
          },
          expenseName: { type: ['string', 'null'] },
          expenseCategoryId: { type: ['string', 'null'] },
          expenseLabelConfidence: { type: 'number', minimum: 0, maximum: 1 },
          existingExpenseId: { type: ['string', 'null'] },
          existingExpenseConfidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['items', 'expenseName', 'expenseCategoryId', 'expenseLabelConfidence', 'existingExpenseId', 'existingExpenseConfidence'],
      },
    },
    required: ['store', 'date', 'currency', 'total', 'items', 'confidence', 'needsEscalation', 'matches'],
  },
}

const EXTRACT_PROMPT = `Ты — парсер кассовых чеков. На изображении чек на русском языке (возможны белорусские/украинские слова).
Извлеки строго в JSON:
- store.name — название магазина или сети (как на чеке, без юридической формы если есть короткое торговое имя)
- store.address — ПОЛНЫЙ адрес покупки одной строкой. Если магазин находится в торговом центре (ТРЦ, ТЦ, МФК, аутлет, рынок, гипермаркет-якорь и т.п.), обязательно укажи название этого ТЦ перед уличным адресом, например: "ТРЦ Палаццо, г. Минск, ул. Тимирязева, 74, корпус А". Название ТЦ обычно печатается отдельной строкой в шапке чека или указывается рядом с адресом. Не теряй ни одной части — город, улицу, дом, корпус.
- date — дата покупки в формате YYYY-MM-DD
- currency — валюта чека (BYN/RUB/USD/EUR и т.п., по умолчанию BYN если не уверен)
- total — итоговая сумма
- items[] — каждая товарная позиция: name (как написано, исправив очевидный OCR-шум: смешанные o/о, a/а, c/с в кириллице), amount (сумма за позицию, не цена за единицу, не количество), опционально packageVolume ("1л", "500г") и manufacturer
- confidence — твоя уверенность в результате 0..1
- needsEscalation — true если чек мятый/плохой свет/срез/много пропусков

Не выдумывай позиции. Если не видишь — оставляй пустой массив. Не включай в items сервисные строки (итого, скидка, нал/безнал, НДС).`

const VALIDATE_PROMPT = `Ты валидатор и подбиратор связей для JSON-чека. Тебе дают:
1) JSON-чек после OCR (поле receipt);
2) выгрузку из пользовательской базы (поле catalog): products (товары), categories (категории расходов), stores (магазины), expenses (последние расходы — здесь видна привычка пользователя как они называют расход и какую категорию выбирают).

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - сумма items[].amount ≈ total (допуск 1%). Если total отсутствует — посчитай и проставь.
   - Кириллица: исправь смешанные латинские o/a/c/p/x/e/H/B на русские эквиваленты внутри слов где это очевидно (например "Moлоko" → "Молоко").
   - Названия магазинов: нормализуй к торговому имени без юр-формы ("ООО ", "ИП ", "ЗАО ").
   - confidence пересчитай учитывая ошибки; если совсем плохо — needsEscalation=true.

B) Заполни matches на основании catalog:
   matches.items: ДЛЯ КАЖДОЙ позиции по itemIndex (0-based, в порядке как в receipt.items) определи лучший продукт из catalog.products. Сравнивай не только название, но и категорию/производителя/объём из позиции. Высокая уверенность (confidence ≥ 0.85) только если это явно тот же товар. Если ничего близкого — productId=null, confidence=0.

   matches.expenseName, matches.expenseCategoryId, matches.expenseLabelConfidence: предложи имя нового расхода и categoryId.
     - В catalog.expenses посмотри ОБЯЗАТЕЛЬНО на поле items[] каждого исторического расхода — там названия позиций которые тогда покупали. Если в текущем чеке есть похожие позиции (по типу товара: футболка ≈ футболка/майка/одежда; колбаса ≈ колбаса/ветчина/мясо; и т.д.), используй name и category из такого исторического расхода.
     - Если прямой связки по позициям нет — определи категорию по типу товаров в чеке (одежда, продукты, аптека и т.п.) и сматчи к catalog.categories[].name.
     - matches.expenseCategoryId должен быть РОВНО одним из catalog.categories[].id (или null если ничего подходящего).
     - matches.expenseName — короткое имя (1-3 слова, как пользователь обычно пишет) или null.
     - Confidence отражает уверенность; не выдумывай высокую уверенность если данных мало.

   matches.existingExpenseId, matches.existingExpenseConfidence: проверь, не дубликат ли это уже существующего расхода.
     - Дубликат: тот же магазин + дата ±1 день + |total - expense.total| ≤ 1% от total.
     - Если нашёл — existingExpenseId из catalog.expenses, confidence > 0.8.
     - Иначе null и 0.

ВАЖНО: productId / expenseCategoryId / existingExpenseId должны быть точными id из catalog (UUID), либо null. Не выдумывай id.`

function base64Bytes(b64: string): number {
  // Approx — every 4 chars encode 3 bytes; padding subtracts a couple.
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

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: unknown[],
): Promise<{ data: ReceiptPayload; rawUsage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/LastSkywalkerer/shop-assist',
      'X-Title': 'ShopAssist Receipt OCR',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: RECEIPT_JSON_SCHEMA },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  const body = await res.json()
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('OpenRouter response missing content')
  }

  let parsed: ReceiptPayload
  try {
    parsed = JSON.parse(content) as ReceiptPayload
  } catch {
    // Some providers don't honor json_schema strictly — try to recover a JSON
    // object from a code-fenced or surrounded text block.
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('OpenRouter returned non-JSON content')
    parsed = JSON.parse(match[0]) as ReceiptPayload
  }

  if (!Array.isArray(parsed.items)) parsed.items = []
  if (typeof parsed.currency !== 'string' || !parsed.currency) parsed.currency = 'BYN'
  if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5
  if (typeof parsed.needsEscalation !== 'boolean') parsed.needsEscalation = false
  if (parsed.matches && typeof parsed.matches === 'object') {
    if (!Array.isArray(parsed.matches.items)) parsed.matches.items = []
    if (typeof parsed.matches.expenseLabelConfidence !== 'number') parsed.matches.expenseLabelConfidence = 0
    if (typeof parsed.matches.existingExpenseConfidence !== 'number') parsed.matches.existingExpenseConfidence = 0
    if (parsed.matches.expenseName === undefined) parsed.matches.expenseName = null
    if (parsed.matches.expenseCategoryId === undefined) parsed.matches.expenseCategoryId = null
    if (parsed.matches.existingExpenseId === undefined) parsed.matches.existingExpenseId = null
  }

  return { data: parsed, rawUsage: body?.usage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!supabaseUrl || !serviceKey || !openrouterKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
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
    return new Response(JSON.stringify({ ok: false, error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    return new Response(JSON.stringify({ ok: false, error: 'User not found' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userId = userRow.id as string

  // Read room_id out of the JWT (set on switchRoom). Optional — only used for
  // logging and for resolving model defaults.
  let roomId: string | null = null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    roomId = payload?.user_metadata?.room_id ?? null
  } catch { /* ignore */ }

  // Rate-limit: count recent rows for this user.
  const nowIso = new Date().toISOString()
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [{ count: perMin }, { count: perDay }] = await Promise.all([
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', minuteAgo),
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', dayAgo),
  ])
  if ((perMin ?? 0) >= LIMIT_PER_MINUTE) {
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'minute' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if ((perDay ?? 0) >= LIMIT_PER_DAY) {
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'day' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!body || (body.pass !== 'extract' && body.pass !== 'validate' && body.pass !== 'escalate')) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid pass' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (typeof body.model !== 'string' || !body.model) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing model' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Build messages per pass.
  let messages: unknown[]

  if (body.pass === 'extract' || body.pass === 'escalate') {
    if (!body.imageBase64) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing imageBase64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Soft size cap: ~6 MB raw bytes = ~8 MB base64. Anything bigger is almost
    // certainly an uncompressed PNG; reject early instead of paying OpenRouter
    // to fail.
    if (base64Bytes(body.imageBase64) > 6 * 1024 * 1024) {
      return new Response(JSON.stringify({ ok: false, error: 'Image too large (≤6 MB after base64 decode)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mime = body.imageMimeType && /^image\/(jpeg|png|webp)$/.test(body.imageMimeType) ? body.imageMimeType : 'image/jpeg'
    messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${body.imageBase64}` } },
        { type: 'text', text: EXTRACT_PROMPT + (body.currency ? `\n\nПодсказка по валюте по умолчанию: ${body.currency}.` : '') },
      ],
    }]
  } else {
    // validate
    if (!body.previousJson) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing previousJson' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const catalog = body.catalog ?? {}
    messages = [{
      role: 'user',
      content: VALIDATE_PROMPT
        + '\n\nreceipt:\n' + JSON.stringify(body.previousJson)
        + '\n\ncatalog:\n' + JSON.stringify(catalog),
    }]
  }

  let result: { data: ReceiptPayload; rawUsage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    result = await callOpenRouter(openrouterKey, body.model, messages)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OpenRouter error'
    console.error(`ocr-receipt[${body.pass}/${body.model}]`, msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const cost = estimateCost(body.model, result.rawUsage)
  await supabase.from('ai_usage_log').insert({
    user_id: userId,
    room_id: roomId,
    function_name: 'ocr-receipt',
    model: body.model,
    pass: body.pass,
    cost_usd: cost,
    created_at: nowIso,
  })

  return new Response(JSON.stringify({ ok: true, json: result.data, costUsd: cost }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
