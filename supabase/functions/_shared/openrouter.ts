// OpenRouter prompts, JSON schema, and the call helper shared by all OCR
// edge functions. Keep prompt edits in this file only.

import type { Log } from './log.ts'
import type { Catalog, Pass, ReceiptPayload } from './types.ts'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'google/gemini-2.5-flash':            { in: 0.00030, out: 0.00250 },
  'google/gemini-2.5-flash-lite':       { in: 0.00010, out: 0.00040 },
  'google/gemini-2.5-pro':              { in: 0.00125, out: 0.01000 },
  'qwen/qwen3-vl-30b-a3b-instruct':     { in: 0.00013, out: 0.00052 },
  'qwen/qwen3-vl-235b-a22b':            { in: 0.00020, out: 0.00088 },
  'openai/gpt-5-mini':                  { in: 0.00025, out: 0.00200 },
  'openai/gpt-4.1-mini':                { in: 0.00040, out: 0.00160 },
}

export const RECEIPT_JSON_SCHEMA = {
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
      currency: { type: 'string', description: 'ISO 4217 code such as BYN, RUB, USD, EUR, HUF, RSD, BAM' },
      total: { type: ['number', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            quantity: { type: 'number' },
            needsReview: { type: 'boolean' },
            packageVolume: { type: ['string', 'null'] },
            manufacturer: { type: ['string', 'null'] },
          },
          required: ['name', 'amount', 'quantity', 'needsReview', 'packageVolume', 'manufacturer'],
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
                cleanedName: { type: 'string' },
                productName: { type: ['string', 'null'] },
                variety: { type: ['string', 'null'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['itemIndex', 'cleanedName', 'productName', 'variety', 'confidence'],
            },
          },
          expenseLabel: { type: ['string', 'null'] },
          expenseCategoryName: { type: ['string', 'null'] },
          storeName: { type: ['string', 'null'] },
        },
        required: ['items', 'expenseLabel', 'expenseCategoryName', 'storeName'],
      },
    },
    required: ['store', 'date', 'currency', 'total', 'items', 'confidence', 'needsEscalation', 'matches'],
  },
}

export const EXTRACT_PROMPT = `Ты — парсер кассовых чеков. На изображении чек на русском языке (возможны белорусские/украинские слова).
Извлеки строго в JSON:
- store.name — название магазина или сети
- store.address — ПОЛНЫЙ адрес покупки одной строкой. Если магазин в ТРЦ/ТЦ/МФК/аутлете/рынке — укажи название ТЦ перед уличным адресом (например: "ТРЦ Палаццо, г. Минск, ул. Тимирязева, 74, корпус А"). Не теряй город, улицу, дом, корпус.
- date — YYYY-MM-DD
- currency — BYN/RUB/USD/EUR/HUF/RSD/BAM/PLN/UAH и т.п. (по умолчанию BYN)
- total — итоговая сумма
- items[] — позиции. Для каждой:
    * name — исправь смешанные o/о, a/а, c/с в кириллице.
    * amount — ЦЕНА ЗА ЕДИНИЦУ (за 1 шт / 1 кг / 1 л). НЕ итог по строке.
    * quantity — количество единиц (число, дробное допустимо, шаг 0.001):
        – "2 × 50.00 = 100.00"           → quantity=2,     amount=50.00
        – "0.350 кг × 12.50 = 4.38"      → quantity=0.350, amount=12.50
        – "Молоко 1л — 3.50"             → quantity=1,     amount=3.50
    * needsReview — true ТОЛЬКО если строку нельзя однозначно разложить на количество × цену за единицу. В этом случае верни quantity=1 и amount=итог по строке. Иначе false.
    * packageVolume — объём/вес упаковки (например "1л", "500г"), null если не видишь.
    * manufacturer — производитель, null если не видишь.
- confidence — 0..1
- needsEscalation — true если плохо распознали

Опциональные поля (store, date, total, packageVolume, manufacturer, address) — если не видишь, пиши null, не пропускай ключ. matches всегда null на этом проходе.
Не выдумывай позиции. Не включай в items сервисные строки (итого, скидка, нал/безнал, НДС).`

export const VALIDATE_PROMPT = `Ты валидатор и подбиратор связей для JSON-чека. Тебе дают:
1) JSON-чек после OCR (поле receipt);
2) catalog — пользовательская база группированная по двум индексам:
   - categoryNames: канонический плоский список категорий расходов (для поля expenseCategoryName);
   - storeNames: канонический плоский список магазинов (для поля storeName);
   - expenseLabels: индекс по уникальным меткам расходов. Каждая запись { name, categories[], stores[], items[] } — это label которым пользователь раньше называл такие расходы, и всё что с ним когда-либо ассоциировалось (категории, магазины, и имена товаров из чеков прикреплённых к таким расходам);
   - products: индекс по уникальным товарам. Каждая запись { name, categories[], stores[] } — это товар который пользователь уже заводил, плюс категории расходов в которых он встречался и магазины в которых его покупали.

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - amount — цена за единицу, quantity — количество. Σ items[].amount * items[].quantity ≈ total (допуск 1%); если total нет — посчитай как Σ amount*quantity.
   - Кириллица: латинские o/a/c/p/x/e/H/B → русские внутри слов ("Moлoko" → "Молоко").
   - Название магазина — торговое имя без юр-формы.
   - confidence пересчитай; плохой чек — needsEscalation=true.

B) Заполни matches. ВСЕГДА давай лучший доступный вариант — не оставляй null если есть хоть какой-то разумный кандидат.

   matches.items: для КАЖДОЙ позиции по itemIndex (0-based). Алгоритм подбора productName:
     ШАГ 1. Скан catalog.products[] — ищем запись где products[i].name семантически соответствует позиции чека (тот же товар по смыслу: учти бренд/объём/категорию).
     ШАГ 2. Если кандидатов несколько или сомневаешься — усиливай сигнал через ВЛОЖЕННЫЕ ПОЛЯ записи:
        2a. в первую очередь — пересекается ли products[i].categories с типом товаров в чеке/категорией всего расхода (см. шаг расчёта expenseLabel ниже);
        2b. во вторую — пересекается ли products[i].stores с магазином чека (receipt.store.name).
        Эти пересечения повышают confidence; их отсутствие — понижают.
     ШАГ 3. Заполни поля позиции:
        - cleanedName — ОБЯЗАТЕЛЬНО, короткое читаемое имя (2-4 слова), без артикулов/штрих-кодов/размеров.
          • Если нашли подходящий products[i] на шагах 1-2 — берём его name буква-в-букву.
          • Иначе — формируем обобщённое имя из читаемой части ("футболка женская BF2621120062 (40/100/96, L, 9, 170)" → "Футболка женская"; "молоко Савушкин 1л 3.6%" → "Молоко").
        - productName — РОВНО строка products[i].name если cleanedName взято оттуда, иначе null.
        - variety — всё что вырезали в шаге 3.cleanedName (артикул, размер, цвет, кодировка); null если резать нечего.
        - confidence — уверенность что productName = тот же товар. ≥ 0.85 только при явном совпадении (название + ВЛОЖЕННЫЕ категории/магазины сходятся). Если productName=null — 0.

   matches.expenseLabel + matches.expenseCategoryName. Алгоритм:
     ШАГ 1. Скан catalog.expenseLabels[] — ищем запись где expenseLabels[i].name семантически близок к ЧЕКУ В ЦЕЛОМ (по типу товаров, по магазину, по сумме). Например чек с одеждой → ищем label типа "Рубашки"/"Одежда"; чек с продуктами → "Магаз"/"Продукты".
     ШАГ 2. Если кандидатов несколько или сомневаешься — усиливай через ВЛОЖЕННЫЕ ПОЛЯ:
        2a. в ПЕРВУЮ очередь — пересекается ли expenseLabels[i].categories с типом товаров в чеке (если в чеке еда — категории расхода тяготеют к "Еда");
        2b. во ВТОРУЮ — пересекается ли expenseLabels[i].items с позициями чека (если позиции "Молоко"/"Творог" встречаются в items label-а "Магаз" — сильный сигнал что это "Магаз");
        2c. в ТРЕТЬЮ — пересекается ли expenseLabels[i].stores с магазином чека.
     ШАГ 3. Если нашли подходящий expenseLabels[i]:
        - expenseLabel = его name буква-в-букву;
        - expenseCategoryName = одна из expenseLabels[i].categories (та что лучше соответствует чеку). Если их несколько — выбираем самую релевантную; если только одна — её.
     ШАГ 4. Если ничего не нашли:
        - expenseLabel — генерируем короткое (1-3 слова) обобщённое имя в стиле каталога ("Одежда", "Аптека", "Заправка"). Лучше использовать слово которое есть в categoryNames;
        - expenseCategoryName — РОВНО строка из плоского catalog.categoryNames которая лучше всего описывает чек (одежда → "Одежда"; продукты → "Еда"; аптека → "Здоровье"). Если ни одна не подходит — null.

   matches.storeName. Алгоритм:
     - Если в catalog.storeNames есть имя обозначающее тот же магазин что receipt.store.name (учти орфографию, перестановки, "Евроопт" ≈ "Евроопт гипер", "Лодэ" ≈ "ЛОДЭ", торговую марку без юр-формы) — берём его буква-в-букву.
     - Если ни одного похожего — null (клиент создаст новый магазин из receipt.store.name).

ВАЖНО: productName, expenseCategoryName, storeName — ТОЛЬКО точная подстановка из соответствующего источника (products[].name / categoryNames / storeNames), либо null. expenseLabel и cleanedName можно генерировать если в catalog нет подходящего.`

// --- Bulk expense-list parsing (parse-expense-list edge function) ---

export const EXPENSE_LIST_JSON_SCHEMA = {
  name: 'expense_list',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      currency: { type: 'string', description: 'ISO 4217 default currency for the whole list (BYN/RUB/USD/EUR/HUF/RSD/BAM…)' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, or null if the line has no date' },
            name: { type: 'string', description: 'human-readable expense name, exactly as in the source' },
            amount: { type: 'number', description: 'ABSOLUTE (always positive) value of the transaction; never include the sign here' },
            direction: { type: 'string', enum: ['expense', 'income'], description: 'expense = money out (red / negative / minus / списание); income = money in (green / positive / plus / поступление)' },
            currency: { type: ['string', 'null'], description: 'ISO 4217 if the row has its own currency, else null' },
            matchedLabel: { type: ['string', 'null'], description: 'exact string from the provided labels[], else null' },
            categoryName: { type: ['string', 'null'], description: 'exact string from the provided categoryNames[], else null' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['date', 'name', 'amount', 'direction', 'currency', 'matchedLabel', 'categoryName', 'confidence'],
        },
      },
    },
    required: ['currency', 'rows'],
  },
}

export const EXPENSE_LIST_PROMPT = `Ты — парсер списка расходов (журнала трат, выписки по счёту). На входе может быть НЕСКОЛЬКО изображений (страниц/скриншотов одной выписки), PDF или текст. Одна строка/позиция = одна операция. Если изображений несколько — считай их продолжением одного списка и не дублируй строки. Извлеки строго в JSON:
- currency — валюта по умолчанию для всего списка (ISO 4217: BYN/RUB/USD/EUR/HUF/RSD/BAM…), по умолчанию BYN.
- rows[] — по одному элементу на каждую операцию:
    * date — дата операции в формате YYYY-MM-DD. Если у строки нет даты — null.
    * name — человеко-читаемое название операции РОВНО как в источнике. Исправь только явные опечатки и смешанные o/о, a/а, c/с, p/р в кириллице.
    * amount — сумма операции числом, ВСЕГДА ПОЛОЖИТЕЛЬНАЯ (модуль, без знака и без валюты). Знак передавай через direction, а НЕ в amount.
    * direction — направление движения денег:
        – "expense" (расход, деньги уходят): сумма красная и/или со знаком «-», помечена как списание/оплата/покупка/перевод исходящий. В выписках это обычная трата.
        – "income" (доход, деньги приходят): сумма зелёная и/или со знаком «+», помечена как поступление/зачисление/возврат/пополнение/входящий перевод.
        Ориентируйся в первую очередь на ЦВЕТ и ЗНАК суммы, затем на текст операции. Если совсем непонятно — ставь "expense".
    * currency — ISO-код валюты, если у конкретной строки своя валюта; иначе null.
    * matchedLabel — РОВНО строка из переданного списка labels, если строка явно относится к уже известному пользователю названию расхода; иначе null. НЕ выдумывай — только точная подстановка из labels.
    * categoryName — РОВНО строка из переданного списка categoryNames, которая лучше всего описывает трату; иначе null.
    * confidence — 0..1, уверенность в правильности строки.

Игнорируй итоги, подытоги, заголовки таблиц, остаток по счёту, разделители и служебные строки. Не выдумывай операции — извлекай только то, что есть в источнике.`

export function base64Bytes(b64: string): number {
  const padding = (b64.match(/=+$/)?.[0]?.length ?? 0)
  return Math.floor((b64.length * 3) / 4) - padding
}

export function estimateCost(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): number | null {
  if (!usage) return null
  const price = MODEL_PRICES[model]
  if (!price) return null
  const inT = (usage.prompt_tokens ?? 0) / 1000
  const outT = (usage.completion_tokens ?? 0) / 1000
  return +(inT * price.in + outT * price.out).toFixed(6)
}

export interface CallResult {
  data: ReceiptPayload
  rawUsage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface RawCallResult<T> {
  data: T
  rawUsage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Generic OpenRouter strict-JSON call. Performs the request, logs it, and
 * parses the assistant content (with a greedy `{…}` fallback) into `T`. Used
 * directly by non-receipt callers (e.g. parse-expense-list); the receipt
 * pipeline goes through `callOpenRouter`, which wraps this and then applies
 * receipt-specific normalization.
 */
export async function callOpenRouterSchema<T>(
  apiKey: string,
  model: string,
  messages: unknown[],
  log: Log,
  jsonSchema: unknown,
  opts?: { reasoningEffort?: 'low' | 'medium' | 'high'; signal?: AbortSignal },
): Promise<RawCallResult<T>> {
  const reqBody: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: jsonSchema },
  }
  if (opts?.reasoningEffort) {
    reqBody.reasoning = { effort: opts.reasoningEffort }
  }

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
      const parts = msg.content as Array<{ type?: string; text?: string; image_url?: { url?: string }; file?: { filename?: string; file_data?: string } }>
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]
        if (part.type === 'text' && typeof part.text === 'string') {
          log.block('openrouter:msg', `message[${i}].content[${p}] text`, part.text)
        } else if (part.type === 'image_url') {
          const url = part.image_url?.url ?? ''
          const head = url.slice(0, url.indexOf(',') + 1) || '<no-prefix>'
          log.step('openrouter:msg', { idx: `${i}.${p}`, type: 'image_url', prefix: head, payload_bytes: Math.max(0, url.length - head.length) })
        } else if (part.type === 'file') {
          const data = part.file?.file_data ?? ''
          const head = data.slice(0, data.indexOf(',') + 1) || '<no-prefix>'
          log.step('openrouter:msg', { idx: `${i}.${p}`, type: 'file', filename: part.file?.filename ?? null, prefix: head, payload_bytes: Math.max(0, data.length - head.length) })
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
    signal: opts?.signal,
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

  let parsed: T
  try {
    parsed = JSON.parse(content) as T
  } catch {
    log.warn('openrouter:json_parse_fallback', 'strict JSON.parse failed; trying greedy match')
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('OpenRouter returned non-JSON content')
    parsed = JSON.parse(match[0]) as T
  }

  return { data: parsed, rawUsage: body?.usage }
}

export async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: unknown[],
  log: Log,
  opts?: { reasoningEffort?: 'low' | 'medium' | 'high'; signal?: AbortSignal },
): Promise<CallResult> {
  const { data: parsed, rawUsage } = await callOpenRouterSchema<ReceiptPayload>(
    apiKey, model, messages, log, RECEIPT_JSON_SCHEMA, opts,
  )

  if (!Array.isArray(parsed.items)) parsed.items = []
  for (const it of parsed.items) {
    if (typeof it.quantity !== 'number' || !(it.quantity > 0)) it.quantity = 1
    if (typeof it.needsReview !== 'boolean') it.needsReview = false
  }
  if (typeof parsed.currency !== 'string' || !parsed.currency) parsed.currency = 'BYN'
  if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5
  if (typeof parsed.needsEscalation !== 'boolean') parsed.needsEscalation = false
  if (parsed.matches && typeof parsed.matches === 'object') {
    const m = parsed.matches
    if (!Array.isArray(m.items)) m.items = []
    if (m.expenseLabel === undefined) m.expenseLabel = null
    if (m.expenseCategoryName === undefined) m.expenseCategoryName = null
    if (m.storeName === undefined) m.storeName = null
    for (const it of m.items) {
      if (typeof it.cleanedName !== 'string') it.cleanedName = ''
      if (it.productName === undefined) it.productName = null
      if (it.variety === undefined) it.variety = null
      if (typeof it.confidence !== 'number') it.confidence = 0
    }
  }

  log.step('openrouter:parsed_summary', {
    items: parsed.items.length,
    confidence: parsed.confidence,
    needsEscalation: parsed.needsEscalation,
    has_matches: !!parsed.matches,
    match_items: parsed.matches?.items?.length ?? 0,
    expenseLabel: parsed.matches?.expenseLabel ?? null,
    expenseCategoryName: parsed.matches?.expenseCategoryName ?? null,
    storeName: parsed.matches?.storeName ?? null,
    item_cleaned_names: parsed.matches?.items?.map((i) => i.cleanedName) ?? [],
  })
  log.block('openrouter:parsed_full', 'normalized payload', JSON.stringify(parsed, null, 2))

  return { data: parsed, rawUsage }
}

export function catalogStats(catalog: Catalog): Record<string, number> {
  return {
    categoryNames: catalog.categoryNames?.length ?? 0,
    storeNames: catalog.storeNames?.length ?? 0,
    expenseLabels: catalog.expenseLabels?.length ?? 0,
    products: catalog.products?.length ?? 0,
  }
}

export type { Pass }
