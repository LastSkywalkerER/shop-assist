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

async function buildCatalog(roomId) {
  const [products, categories, stores, expenses, receipts, receiptItems] = await Promise.all([
    fetchAlive('products_sync', roomId, 'id, name, category, created_at'),
    fetchAlive('expense_categories_sync', roomId, 'id, name'),
    fetchAlive('stores_sync', roomId, 'id, name'),
    fetchAlive('expenses_sync', roomId, 'id, name, store_id, amount, date, category_id'),
    fetchAlive('receipts_sync', roomId, 'id, expense_id'),
    fetchAlive('receipt_items_sync', roomId, 'id, receipt_id, name'),
  ])

  const storeNameById = new Map(stores.map((s) => [s.id, s.name]))
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))

  const receiptIdToItems = new Map()
  for (const ri of receiptItems) {
    const arr = receiptIdToItems.get(ri.receipt_id) ?? []
    if (arr.length < 5) arr.push(ri.name)
    receiptIdToItems.set(ri.receipt_id, arr)
  }
  const expenseIdToItems = new Map()
  for (const r of receipts) {
    const items = receiptIdToItems.get(r.id)
    if (items && items.length) expenseIdToItems.set(r.expense_id, items)
  }

  return {
    products: products
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .slice(0, 400)
      .map((p) => ({ id: p.id, name: p.name, category: p.category ?? null })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    expenses: [...expenses]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 150)
      .map((e) => ({
        id: e.id,
        name: e.name ?? null,
        category: e.category_id ? (categoryNameById.get(e.category_id) ?? null) : null,
        store: e.store_id ? (storeNameById.get(e.store_id) ?? null) : null,
        date: (e.date ?? '').slice(0, 10),
        total: e.amount,
        items: expenseIdToItems.get(e.id),
      })),
  }
}

function summary(catalog) {
  return {
    products: catalog.products.length,
    categories: catalog.categories.length,
    stores: catalog.stores.length,
    expenses: catalog.expenses.length,
    expenses_with_items: catalog.expenses.filter((e) => e.items?.length).length,
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
