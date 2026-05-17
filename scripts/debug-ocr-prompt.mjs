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
2) catalog с НАЗВАНИЯМИ из пользовательской базы:
   - productNames: уникальные имена существующих товаров
   - categoryNames: уникальные имена категорий расходов
   - storeNames: уникальные имена магазинов
   - expenseLabels: уникальные имена которыми пользователь раньше называл расходы
   - recentExpenses[]: последние расходы со связкой label↔items↔category — здесь видна привычка как пользователь называет расход и какую категорию выбирает.

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - сумма items[].amount ≈ total (допуск 1%). Если total отсутствует — посчитай и проставь.
   - Кириллица: исправь смешанные латинские o/a/c/p/x/e/H/B на русские эквиваленты внутри слов где это очевидно (например "Moлоko" → "Молоко").
   - Названия магазинов: нормализуй к торговому имени без юр-формы ("ООО ", "ИП ", "ЗАО ").
   - confidence пересчитай учитывая ошибки; если совсем плохо — needsEscalation=true.

B) Заполни matches возвращая ИМЕНА (строки) из caталога, не выдумывая:
   matches.items: ДЛЯ КАЖДОЙ позиции по itemIndex (0-based, в порядке receipt.items) выбери productName РОВНО из catalog.productNames — то которое описывает этот же товар. Учитывай категорию/производителя/объём. confidence ≥ 0.85 только если это явно тот же товар. Если в каталоге ничего подходящего — productName=null, confidence=0.

   matches.expenseLabel, matches.expenseCategoryName, matches.expenseLabelConfidence: предложи имя нового расхода и категорию.
     - В catalog.recentExpenses посмотри ОБЯЗАТЕЛЬНО на поле items[] каждого исторического расхода — там названия позиций которые тогда покупали. Если в текущем чеке есть похожие позиции (футболка ≈ футболка/майка/одежда; колбаса ≈ колбаса/ветчина/мясо; и т.д.), бери label И category из такого исторического расхода — это и есть привычка пользователя.
     - Если прямой связки нет — выбери categoryName из catalog.categoryNames по типу товаров (одежда → "Одежда"; продукты → "Еда"; аптека → "Здоровье" и т.п.), и предложи expenseLabel из catalog.expenseLabels если подходит, иначе сгенерируй короткое (1-3 слова) в том же стиле.
     - expenseCategoryName ДОЛЖЕН быть РОВНО одной из catalog.categoryNames (или null).
     - confidence пониже если данных мало, повыше при явной связке через items.

   matches.duplicateDate/duplicateTotal/duplicateStoreName/duplicateConfidence: дубликат ли это уже существующего расхода?
     - Дубликат: тот же магазин + дата ±1 день + |total - expense.total| ≤ 1% от total. Сравнивай с recentExpenses.
     - Если нашёл — заполни date/total/storeName РОВНО из найденного recentExpense, confidence > 0.8.
     - Иначе все три null и confidence=0.

ВАЖНО: productName / expenseCategoryName / expenseLabel / duplicateStoreName должны браться ИЗ КАТАЛОГА буква в букву, либо null. Не придумывай новые названия которых нет в catalog (кроме expenseLabel если ничего вообще не подошло).`

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

  const sortedExpenses = [...expenses].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return {
    productNames: dedupe(products.map((p) => p.name), 300),
    categoryNames: categories.map((c) => c.name),
    storeNames: dedupe(stores.map((s) => s.name), 80),
    expenseLabels: dedupe(sortedExpenses.map((e) => e.name), 50),
    recentExpenses: sortedExpenses.slice(0, 50).map((e) => ({
      label: e.name ?? null,
      category: e.category_id ? (categoryNameById.get(e.category_id) ?? null) : null,
      store: e.store_id ? (storeNameById.get(e.store_id) ?? null) : null,
      date: (e.date ?? '').slice(0, 10),
      total: e.amount,
      items: expenseIdToItems.get(e.id) ?? [],
    })),
  }
}

function summary(catalog) {
  return {
    productNames: catalog.productNames.length,
    categoryNames: catalog.categoryNames.length,
    storeNames: catalog.storeNames.length,
    expenseLabels: catalog.expenseLabels.length,
    recentExpenses: catalog.recentExpenses.length,
    recentExpenses_with_items: catalog.recentExpenses.filter((e) => e.items?.length).length,
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
