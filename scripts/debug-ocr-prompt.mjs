#!/usr/bin/env node
// Debug helper for the OCR validate-pass prompt.
//
// Pulls the same catalog the client (ScanReceiptFlow) would assemble for a
// given room and prints the full validate-pass payload — VALIDATE_PROMPT
// followed by the receipt + catalog JSON — exactly as it would be sent to
// OpenRouter. Useful for inspecting *why* the model isn't picking up an
// expected match (e.g. is the "Одежда" expense actually in the catalog? Are
// its receipt items attached?).
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=<service-role-key> \
//     node scripts/debug-ocr-prompt.mjs <room_id> [path/to/receipt.json]
//
//   --send                  also call OpenRouter (needs OPENROUTER_API_KEY)
//                           and print the response
//   --model=<id>            override the validate-pass model
//                           (default: openai/gpt-5-mini)
//   --no-prompt             skip printing the prompt (only run the request)
//
// If no receipt.json is given, a hardcoded "футболка 33 BYN" sample is used.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { argv, env, exit } from 'node:process'

const args = argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const opts = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const i = a.indexOf('=')
      return [a.slice(2, i), a.slice(i + 1)]
    }),
)
const positional = args.filter((a) => !a.startsWith('--'))
const roomId = positional[0]
const receiptPath = positional[1]

if (!roomId) {
  console.error('Usage: node scripts/debug-ocr-prompt.mjs <room_id> [receipt.json]')
  exit(1)
}

const SUPABASE_URL = env.SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in env.')
  exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Keep these strings byte-for-byte in sync with
// supabase/functions/ocr-receipt/index.ts so the debug output reflects what
// the deployed function actually sends.
const VALIDATE_PROMPT = `Ты валидатор и подбиратор связей для JSON-чека. Тебе дают:
1) JSON-чек после OCR (поле receipt);
2) catalog — ТОЛЬКО списки уникальных имён из пользовательской базы:
   - productNames: имена существующих товаров (то как пользователь их пишет)
   - categoryNames: имена категорий расходов
   - storeNames: имена магазинов
   - expenseLabels: имена которыми пользователь обычно называл расходы

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - сумма items[].amount ≈ total (допуск 1%); если total нет — посчитай.
   - Кириллица: латинские o/a/c/p/x/e/H/B → русские внутри слов ("Moлоko" → "Молоко").
   - Название магазина — торговое имя без юр-формы.
   - confidence пересчитай; плохой чек — needsEscalation=true.

B) Заполни matches. ВСЕГДА давай лучший доступный вариант — не оставляй null если есть хоть какой-то разумный кандидат.

   matches.items: для КАЖДОЙ позиции по itemIndex (0-based):
     1. cleanedName — ОБЯЗАТЕЛЬНО, короткое читаемое имя позиции (2-4 слова), очищенное от артикулов/штрих-кодов/размеров/серийников. Алгоритм выбора:
        - Если в catalog.productNames есть имя которое описывает тот же товар (по смыслу) — берём его буква в букву.
        - Иначе — формируем обобщённое название из читаемой части (например "футболка женская BF2621120062 (40/100/96, L, 9, 170)" → "Футболка женская"; "молоко Савушкин 1л 3.6%" → "Молоко").
     2. productName — РОВНО строка из catalog.productNames если cleanedName взято оттуда. Иначе null.
     3. variety — всё что вырезали в шаг 1 (артикул, размер, цвет, кодировка); null если вырезать нечего.
     4. confidence — насколько уверены что productName указывает на тот же товар. ≥ 0.85 только при явном совпадении (название + бренд/объём/категория сходятся). Если productName=null — 0.

   matches.expenseLabel — лучший label для этого расхода:
     - Если в catalog.expenseLabels есть подходящий (по смыслу содержимого чека) — берём ровно его.
     - Иначе — генерируем короткое (1-3 слова) обобщённое имя в стиле каталога (например "Одежда", "Аптека", "Заправка"). Лучше использовать слово которое есть в categoryNames.
     - null только если совсем нечего предложить.

   matches.expenseCategoryName — РОВНО строка из catalog.categoryNames которая лучше всего описывает чек по типу товаров (одежда → "Одежда"; продукты → "Еда"; аптека → "Здоровье"). Если ни одна не подходит — null.

ВАЖНО: productName и expenseCategoryName — ТОЛЬКО точная подстановка из caталога, либо null. expenseLabel и cleanedName можно генерировать если в catalog нет подходящего.`

const SAMPLE_RECEIPT = {
  store: { name: 'befree', address: 'ТРЦ Палаццо, г. Минск, ул. Тимирязева, 74, корпус А' },
  date: '2026-05-15',
  currency: 'BYN',
  total: 33.0,
  items: [
    { name: 'футболка женская BF2621120062 (40/100/96)', amount: 33.0, packageVolume: null, manufacturer: null },
  ],
  confidence: 0.9,
  needsEscalation: false,
  matches: null,
}

async function fetchAlive(table, room, select) {
  // Sync tables flag deletes via _deleted=true; live data is _deleted IS NULL OR false.
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('room_id', room)
    .or('_deleted.is.null,_deleted.eq.false')
  if (error) throw new Error(`${table}: ${error.message}`)
  return data ?? []
}

function dedupe(arr, cap) {
  const seen = new Set()
  const out = []
  for (const v of arr) {
    if (!v) continue
    const trimmed = String(v).trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= cap) break
  }
  return out
}

async function buildCatalog(roomId) {
  const [products, categories, stores, expenses] = await Promise.all([
    fetchAlive('products_sync', roomId, 'id, name, created_at'),
    fetchAlive('expense_categories_sync', roomId, 'id, name'),
    fetchAlive('stores_sync', roomId, 'id, name'),
    fetchAlive('expenses_sync', roomId, 'id, name, date'),
  ])
  const sortedExpenses = [...expenses].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return {
    productNames: dedupe(products.map((p) => p.name), 300),
    categoryNames: dedupe(categories.map((c) => c.name), 100),
    storeNames: dedupe(stores.map((s) => s.name), 80),
    expenseLabels: dedupe(sortedExpenses.map((e) => e.name), 100),
  }
}

function summary(catalog) {
  return {
    productNames: catalog.productNames.length,
    categoryNames: catalog.categoryNames.length,
    storeNames: catalog.storeNames.length,
    expenseLabels: catalog.expenseLabels.length,
  }
}

async function main() {
  const receipt = receiptPath
    ? JSON.parse(readFileSync(receiptPath, 'utf8'))
    : SAMPLE_RECEIPT

  console.error(`Pulling catalog for room ${roomId}…`)
  const catalog = await buildCatalog(roomId)
  console.error('Catalog stats:', summary(catalog))

  const promptText =
    VALIDATE_PROMPT +
    '\n\nreceipt:\n' + JSON.stringify(receipt, null, 2) +
    '\n\ncatalog:\n' + JSON.stringify(catalog, null, 2)

  if (!flags.has('--no-prompt')) {
    console.log('===== VALIDATE PASS — USER MESSAGE =====')
    console.log(promptText)
    console.log('===== END =====')
    const approxTokens = Math.ceil(promptText.length / 4)
    console.error(`Approx tokens: ${approxTokens}`)
  }

  if (flags.has('--send')) {
    const orKey = env.OPENROUTER_API_KEY
    if (!orKey) {
      console.error('Set OPENROUTER_API_KEY to use --send.')
      exit(1)
    }
    const model = opts.model ?? 'openai/gpt-5-mini'
    console.error(`Calling OpenRouter (${model})…`)
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/LastSkywalkerer/shop-assist',
        'X-Title': 'ShopAssist debug-ocr-prompt',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: promptText }],
      }),
    })
    const body = await res.json()
    console.log('\n===== OPENROUTER RESPONSE =====')
    console.log(JSON.stringify(body, null, 2))
  }
}

main().catch((err) => {
  console.error('Error:', err)
  exit(1)
})
