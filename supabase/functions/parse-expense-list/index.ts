// Synchronous endpoint that parses a *list of expenses* (a spending log) from
// an uploaded image, PDF, or pasted text. Unlike the receipt scanner this is a
// single LLM call that both extracts the rows and maps each raw name to a known
// expense label / category supplied by the client. The client then reconciles
// the rows against existing expenses and bulk-creates the missing ones.
//
// Mirrors the auth + rate-limit boilerplate of `ocr-receipt/index.ts`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { Log, shortId } from '../_shared/log.ts'
import {
  EXPENSE_LIST_JSON_SCHEMA,
  EXPENSE_LIST_PROMPT,
  base64Bytes,
  callOpenRouterSchema,
  estimateCost,
} from '../_shared/openrouter.ts'
import type { ExpenseListPayload } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LIMIT_PER_MINUTE = 20
const LIMIT_PER_DAY = 200
const MAX_DECODED_BYTES = 12 * 1024 * 1024 // 12 MB after base64 decode (PDFs run larger than receipt photos)

type ParseInput =
  | { kind: 'image' | 'pdf'; base64: string; mime?: string; filename?: string }
  | { kind: 'images'; items: { base64: string; mime?: string }[] }
  | { kind: 'text'; text: string }

const MAX_IMAGES = 10

interface RequestBody {
  model: string
  input: ParseInput
  currency?: string
  labels?: string[]
  categoryNames?: string[]
}

function buildPromptText(body: RequestBody): string {
  const parts = [EXPENSE_LIST_PROMPT]
  if (body.currency) parts.push(`\n\nВалюта по умолчанию: ${body.currency}.`)
  if (body.labels?.length) {
    parts.push(`\n\nlabels (известные пользователю названия расходов, для matchedLabel):\n${JSON.stringify(body.labels)}`)
  }
  if (body.categoryNames?.length) {
    parts.push(`\n\ncategoryNames (категории расходов, для categoryName):\n${JSON.stringify(body.categoryNames)}`)
  }
  return parts.join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const log = new Log('parse-expense-list', shortId())
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

  if (typeof body?.model !== 'string' || !body.model) {
    log.warn('body:missing_model')
    return new Response(JSON.stringify({ ok: false, error: 'Missing model' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const kind = body.input?.kind
  if (kind !== 'image' && kind !== 'images' && kind !== 'pdf' && kind !== 'text') {
    log.warn('body:invalid_input_kind', { kind })
    return new Response(JSON.stringify({ ok: false, error: 'Invalid input kind' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  log.step('body:received', {
    model: body.model,
    kind,
    labels: body.labels?.length ?? 0,
    categoryNames: body.categoryNames?.length ?? 0,
    currency_hint: body.currency ?? null,
  })

  const promptText = buildPromptText(body)
  log.block('prep:prompt', 'EXPENSE_LIST prompt (with hints)', promptText)

  let messages: unknown[]
  if (kind === 'text') {
    const text = (body.input as { text?: string }).text
    if (typeof text !== 'string' || !text.trim()) {
      log.warn('prep:missing_text')
      return new Response(JSON.stringify({ ok: false, error: 'Missing text' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    messages = [{ role: 'user', content: `${promptText}\n\nСписок расходов:\n${text}` }]
  } else if (kind === 'images') {
    const items = (body.input as { items?: { base64?: string; mime?: string }[] }).items
    if (!Array.isArray(items) || items.length === 0) {
      log.warn('prep:missing_images')
      return new Response(JSON.stringify({ ok: false, error: 'Missing images' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (items.length > MAX_IMAGES) {
      log.warn('prep:too_many_images', { count: items.length })
      return new Response(JSON.stringify({ ok: false, error: `Слишком много изображений (максимум ${MAX_IMAGES})` }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    let totalDecoded = 0
    const imageParts = items.map((it, i) => {
      const b64 = it?.base64 ?? ''
      totalDecoded += base64Bytes(b64)
      const mime = it.mime && /^image\/(jpeg|png|webp)$/.test(it.mime) ? it.mime : 'image/jpeg'
      log.step('prep:image', { idx: i, mime, base64_chars: b64.length })
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
    })
    if (items.some((it) => !it?.base64)) {
      log.warn('prep:missing_base64_in_images')
      return new Response(JSON.stringify({ ok: false, error: 'Missing base64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (totalDecoded > MAX_DECODED_BYTES) {
      log.warn('prep:too_large', { decoded_bytes: totalDecoded, images: items.length })
      return new Response(JSON.stringify({ ok: false, error: 'Файлы слишком большие (≤12 MB суммарно)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    log.step('prep:images', { count: items.length, total_decoded_bytes: totalDecoded })
    messages = [{ role: 'user', content: [...imageParts, { type: 'text', text: promptText }] }]
  } else {
    const input = body.input as { base64?: string; mime?: string; filename?: string }
    if (!input.base64) {
      log.warn('prep:missing_base64')
      return new Response(JSON.stringify({ ok: false, error: 'Missing base64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const decoded = base64Bytes(input.base64)
    log.step('prep:binary', { kind, decoded_bytes: decoded, base64_chars: input.base64.length, mime_in: input.mime ?? null })
    if (decoded > MAX_DECODED_BYTES) {
      log.warn('prep:too_large', { decoded_bytes: decoded })
      return new Response(JSON.stringify({ ok: false, error: 'File too large (≤12 MB after base64 decode)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (kind === 'image') {
      const mime = input.mime && /^image\/(jpeg|png|webp)$/.test(input.mime) ? input.mime : 'image/jpeg'
      messages = [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${input.base64}` } },
          { type: 'text', text: promptText },
        ],
      }]
    } else {
      // PDF parsed directly by the model via OpenRouter's file content part.
      const filename = input.filename && /\.pdf$/i.test(input.filename) ? input.filename : 'expenses.pdf'
      messages = [{
        role: 'user',
        content: [
          { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${input.base64}` } },
          { type: 'text', text: promptText },
        ],
      }]
    }
  }

  let result
  try {
    log.step('openrouter:call', { model: body.model, kind })
    result = await callOpenRouterSchema<ExpenseListPayload>(
      openrouterKey, body.model, messages, log, EXPENSE_LIST_JSON_SCHEMA,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OpenRouter error'
    log.error('openrouter:exception', { model: body.model, error: msg })
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Normalize defensively — strict schema should already guarantee shape.
  const payload = result.data
  const listCurrency = typeof payload?.currency === 'string' && payload.currency ? payload.currency : (body.currency || 'BYN')
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  const cleanRows = rows
    .filter((r) => r && typeof r.amount === 'number' && isFinite(r.amount) && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      date: typeof r.date === 'string' && r.date ? r.date : null,
      name: r.name.trim(),
      // amount is always stored positive; the model carries the sign in `direction`,
      // but guard against a signed value slipping through.
      amount: Math.abs(r.amount),
      direction: r.direction === 'income' ? 'income' : 'expense',
      currency: typeof r.currency === 'string' && r.currency ? r.currency : null,
      matchedLabel: typeof r.matchedLabel === 'string' && r.matchedLabel ? r.matchedLabel : null,
      categoryName: typeof r.categoryName === 'string' && r.categoryName ? r.categoryName : null,
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
    }))
  log.step('parsed:summary', {
    currency: listCurrency,
    rows: cleanRows.length,
    expense: cleanRows.filter((r) => r.direction === 'expense').length,
    income: cleanRows.filter((r) => r.direction === 'income').length,
  })

  const cost = estimateCost(body.model, result.rawUsage)
  log.step('cost:estimate', { model: body.model, cost_usd: cost, usage: result.rawUsage ?? null })

  const { error: insertErr } = await supabase.from('ai_usage_log').insert({
    user_id: userId,
    room_id: roomId,
    function_name: 'parse-expense-list',
    model: body.model,
    pass: 'extract',
    cost_usd: cost,
    created_at: nowIso,
  })
  if (insertErr) {
    log.warn('usage_log:insert_failed', { error: insertErr.message })
  } else {
    log.step('usage_log:inserted')
  }

  log.step('request:done', { ok: true, model: body.model, rows: cleanRows.length, cost_usd: cost })

  return new Response(JSON.stringify({ ok: true, currency: listCurrency, rows: cleanRows, costUsd: cost }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
