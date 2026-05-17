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
2) catalog — пользовательская база группированная по двум индексам:
   - categoryNames: канонический плоский список категорий расходов (для поля expenseCategoryName);
   - storeNames: канонический плоский список магазинов (для поля storeName);
   - expenseLabels: индекс по уникальным меткам расходов. Каждая запись { name, categories[], stores[], items[] } — это label которым пользователь раньше называл такие расходы, и всё что с ним когда-либо ассоциировалось (категории, магазины, и имена товаров из чеков прикреплённых к таким расходам);
   - products: индекс по уникальным товарам. Каждая запись { name, categories[], stores[] } — это товар который пользователь уже заводил, плюс категории расходов в которых он встречался и магазины в которых его покупали.

A) Очисти receipt — НЕ добавляй и НЕ удаляй позиции:
   - сумма items[].amount ≈ total (допуск 1%); если total нет — посчитай.
   - Кириллица: латинские o/a/c/p/x/e/H/B → русские внутри слов ("Moлоko" → "Молоко").
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

function dedupeStrings(arr) {
  return [...new Set(arr.map((v) => (v ?? '').toString().trim()).filter(Boolean))]
}

async function buildCatalog(roomId) {
  const [products, categories, stores, expenses, receipts, receiptItems, purchases] = await Promise.all([
    fetchAlive('products_sync', roomId, 'id, name'),
    fetchAlive('expense_categories_sync', roomId, 'id, name'),
    fetchAlive('stores_sync', roomId, 'id, name'),
    fetchAlive('expenses_sync', roomId, 'id, name, store_id, category_id'),
    fetchAlive('receipts_sync', roomId, 'id, expense_id'),
    fetchAlive('receipt_items_sync', roomId, 'id, receipt_id, converted_to_purchase_id'),
    fetchAlive('purchases_sync', roomId, 'id, product_id, store_id'),
  ])

  const productById = new Map(products.map((p) => [p.id, p]))
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]))
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))

  const receiptToExpense = new Map(receipts.map((r) => [r.id, r.expense_id]))
  const expenseToReceipts = new Map()
  for (const r of receipts) {
    const arr = expenseToReceipts.get(r.expense_id) ?? []
    arr.push(r.id)
    expenseToReceipts.set(r.expense_id, arr)
  }
  const receiptToItems = new Map()
  for (const ri of receiptItems) {
    const arr = receiptToItems.get(ri.receipt_id) ?? []
    arr.push(ri)
    receiptToItems.set(ri.receipt_id, arr)
  }
  const purchaseById = new Map(purchases.map((p) => [p.id, p]))
  const expenseById = new Map(expenses.map((e) => [e.id, e]))

  // expenseLabels[]
  const labelMap = new Map()
  for (const exp of expenses) {
    const name = exp.name?.trim()
    if (!name) continue
    let entry = labelMap.get(name)
    if (!entry) {
      entry = { name, categories: new Set(), stores: new Set(), items: new Set() }
      labelMap.set(name, entry)
    }
    const catName = exp.category_id ? categoryNameById.get(exp.category_id) : null
    if (catName) entry.categories.add(catName)
    const stName = exp.store_id ? storeNameById.get(exp.store_id) : null
    if (stName) entry.stores.add(stName)
    const rids = expenseToReceipts.get(exp.id) ?? []
    for (const rid of rids) {
      const items = receiptToItems.get(rid) ?? []
      for (const ri of items) {
        if (!ri.converted_to_purchase_id) continue
        const purchase = purchaseById.get(ri.converted_to_purchase_id)
        if (!purchase) continue
        const product = productById.get(purchase.product_id)
        if (product?.name) entry.items.add(product.name.trim())
      }
    }
  }

  // products[]
  const purchaseToExpense = new Map()
  for (const ri of receiptItems) {
    if (!ri.converted_to_purchase_id) continue
    const expId = receiptToExpense.get(ri.receipt_id)
    if (expId) purchaseToExpense.set(ri.converted_to_purchase_id, expId)
  }
  const productMap = new Map()
  for (const purchase of purchases) {
    const product = productById.get(purchase.product_id)
    if (!product?.name) continue
    let entry = productMap.get(product.id)
    if (!entry) {
      entry = { name: product.name.trim(), categories: new Set(), stores: new Set() }
      productMap.set(product.id, entry)
    }
    const stName = purchase.store_id ? storeNameById.get(purchase.store_id) : null
    if (stName) entry.stores.add(stName)
    const expId = purchaseToExpense.get(purchase.id)
    if (expId) {
      const exp = expenseById.get(expId)
      const catName = exp?.category_id ? categoryNameById.get(exp.category_id) : null
      if (catName) entry.categories.add(catName)
    }
  }

  return {
    categoryNames: dedupeStrings(categories.map((c) => c.name)),
    storeNames:    dedupeStrings(stores.map((s) => s.name)),
    expenseLabels: [...labelMap.values()].map((e) => ({
      name: e.name,
      categories: [...e.categories],
      stores:     [...e.stores],
      items:      [...e.items],
    })),
    products: [...productMap.values()].map((p) => ({
      name: p.name,
      categories: [...p.categories],
      stores:     [...p.stores],
    })),
  }
}

function summary(catalog) {
  return {
    categoryNames: catalog.categoryNames.length,
    storeNames: catalog.storeNames.length,
    expenseLabels: catalog.expenseLabels.length,
    products: catalog.products.length,
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
