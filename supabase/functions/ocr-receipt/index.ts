// Synchronous single-pass OCR endpoint. Kept for `scripts/debug-ocr-prompt.mjs`
// and any other tooling that wants direct extract/validate/escalate access.
// The async, user-facing flow runs through `start-receipt-scan` instead.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { Log, shortId } from '../_shared/log.ts'
import {
  EXTRACT_PROMPT,
  VALIDATE_PROMPT,
  base64Bytes,
  callOpenRouter,
  catalogStats,
  estimateCost,
} from '../_shared/openrouter.ts'
import type { Catalog, Pass, ReceiptPayload } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LIMIT_PER_MINUTE = 20
const LIMIT_PER_DAY = 200

interface RequestBody {
  pass: Pass
  model: string
  imageBase64?: string
  imageMimeType?: string
  previousJson?: ReceiptPayload
  currency?: string
  catalog?: Catalog
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const log = new Log('ocr-receipt', shortId())
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
    const currencyHint = body.currency ? `\n\nВалюта по умолчанию: ${body.currency}.` : ''
    const promptText = `${EXTRACT_PROMPT}${currencyHint}`
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
    if (catalog.categoryNames) log.step('prep:catalog_categoryNames', catalog.categoryNames)
    if (catalog.storeNames) log.step('prep:catalog_storeNames', catalog.storeNames)
    if (catalog.expenseLabels) log.step('prep:catalog_expenseLabels_names', catalog.expenseLabels.map((e) => e.name))
    if (catalog.products) log.step('prep:catalog_products_names', catalog.products.map((p) => p.name))

    const receiptStr = JSON.stringify(body.previousJson, null, 2)
    const catalogStr = JSON.stringify(catalog, null, 2)
    log.block('prep:validate_receipt', 'receipt (from extract)', receiptStr)
    log.block('prep:validate_catalog', 'catalog (full)', catalogStr)

    const promptText = `${VALIDATE_PROMPT}

receipt:
${JSON.stringify(body.previousJson)}

catalog:
${JSON.stringify(catalog)}`
    log.step('prep:validate_prompt_size', { total_chars: promptText.length, approx_tokens: Math.ceil(promptText.length / 4) })
    log.block('prep:validate_prompt', 'VALIDATE prompt (final user message)', promptText)

    messages = [{ role: 'user', content: promptText }]
  }

  let result
  try {
    log.step('openrouter:call', { pass: body.pass, model: body.model })
    result = await callOpenRouter(openrouterKey, body.model, messages, log, {
      reasoningEffort: body.pass === 'validate' ? 'medium' : undefined,
    })
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
