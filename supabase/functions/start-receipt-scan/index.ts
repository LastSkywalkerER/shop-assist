// Async receipt OCR orchestrator. Client uploads the image to Storage and
// inserts a pending_receipt_scans row, then POSTs { scanId } here. We:
//   1. validate auth + rate limit, transition status → processing,
//   2. background the 3-pass pipeline via EdgeRuntime.waitUntil,
//   3. return 202 immediately.
// The worker writes back final status (ready | failed) which clients see
// over Realtime.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  createClient,
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2'

import { Log, shortId } from '../_shared/log.ts'
import {
  EXTRACT_PROMPT,
  VALIDATE_PROMPT,
  callOpenRouter,
  catalogStats,
  estimateCost,
} from '../_shared/openrouter.ts'
import { buildCatalog, loadRoomData } from '../_shared/catalog.ts'
import { resolveMatches } from '../_shared/resolve.ts'
import type { Pass, ReceiptPayload } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LIMIT_PER_MINUTE = 20
const LIMIT_PER_DAY = 200

// Treat a processing row as orphaned (worker likely crashed) after this many
// minutes; a retry call will reclaim it.
const ORPHAN_PROCESSING_MINUTES = 10

interface RequestBody {
  scanId?: string
  // Retry semantics: with `force=true` we accept rows in status 'failed' or
  // long-stuck 'processing'. Without it, only 'pending' is accepted.
  force?: boolean
}

interface PendingRow {
  id: string
  room_id: string
  status: 'pending' | 'processing' | 'ready' | 'failed'
  image_storage_path: string
  image_mime: string
  processing_started_at: string | null
}

async function downloadImageBase64(
  supabase: SupabaseClient,
  path: string,
  log: Log,
): Promise<{ base64: string; mime: string; bytes: number }> {
  const t = Date.now()
  const { data, error } = await supabase.storage.from('sync-attachments').download(path)
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`)
  }
  const ab = await data.arrayBuffer()
  const bytes = new Uint8Array(ab)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  const base64 = btoa(binary)
  const mime = (data.type && /^image\/(jpeg|png|webp)$/.test(data.type)) ? data.type : 'image/jpeg'
  log.step('storage:download', { path, ms: Date.now() - t, bytes: bytes.length, mime })
  return { base64, mime, bytes: bytes.length }
}

interface PassResult {
  pass: Pass
  model: string
  cost_usd: number | null
  usage: { prompt_tokens?: number; completion_tokens?: number } | null
}

async function runPipeline(args: {
  supabase: SupabaseClient
  openrouterKey: string
  scanId: string
  roomId: string
  userId: string
  imageBase64: string
  imageMime: string
  models: { extract: string; validate: string; escalate: string }
  defaultCurrency: string | null
  log: Log
}): Promise<{ parsed: ReceiptPayload; passes: PassResult[] }> {
  const { openrouterKey, imageBase64, imageMime, models, defaultCurrency, log } = args
  const passes: PassResult[] = []

  const makeStepSignal = (timeoutMs: number): AbortSignal => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), timeoutMs)
    return ac.signal
  }

  // Pass 1: extract.
  const extractPrompt = EXTRACT_PROMPT + (defaultCurrency ? `\n\nВалюта по умолчанию: ${defaultCurrency}.` : '')
  log.step('pass:extract:start', { model: models.extract })
  const extractRes = await callOpenRouter(openrouterKey, models.extract, [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
      { type: 'text', text: extractPrompt },
    ],
  }], log, { signal: makeStepSignal(60_000) })
  passes.push({
    pass: 'extract',
    model: models.extract,
    cost_usd: estimateCost(models.extract, extractRes.rawUsage),
    usage: extractRes.rawUsage ?? null,
  })
  let parsed = extractRes.data

  // Pass 2: validate (best-effort).
  log.step('pass:validate:start', { model: models.validate })
  const roomData = await loadRoomData(args.supabase, args.roomId)
  const catalog = buildCatalog(roomData)
  log.step('pass:validate:catalog_stats', catalogStats(catalog))
  try {
    const validateText = VALIDATE_PROMPT
      + '\n\nreceipt:\n' + JSON.stringify(parsed)
      + '\n\ncatalog:\n' + JSON.stringify(catalog)
    const validateRes = await callOpenRouter(openrouterKey, models.validate, [
      { role: 'user', content: validateText },
    ], log, { reasoningEffort: 'medium', signal: makeStepSignal(120_000) })
    parsed = validateRes.data
    passes.push({
      pass: 'validate',
      model: models.validate,
      cost_usd: estimateCost(models.validate, validateRes.rawUsage),
      usage: validateRes.rawUsage ?? null,
    })
  } catch (err) {
    log.warn('pass:validate:failed', { error: err instanceof Error ? err.message : String(err) })
  }

  // Pass 3: escalate (only if validate flagged it).
  if (parsed.needsEscalation) {
    log.step('pass:escalate:start', { model: models.escalate })
    try {
      const escalatePrompt = EXTRACT_PROMPT + (defaultCurrency ? `\n\nВалюта по умолчанию: ${defaultCurrency}.` : '')
      const escalateRes = await callOpenRouter(openrouterKey, models.escalate, [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
          { type: 'text', text: escalatePrompt },
        ],
      }], log, { signal: makeStepSignal(60_000) })
      parsed = escalateRes.data
      passes.push({
        pass: 'escalate',
        model: models.escalate,
        cost_usd: estimateCost(models.escalate, escalateRes.rawUsage),
        usage: escalateRes.rawUsage ?? null,
      })
    } catch (err) {
      log.warn('pass:escalate:failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { parsed, passes }
}

async function processScan(args: {
  supabase: SupabaseClient
  openrouterKey: string
  scanId: string
  roomId: string
  userId: string
  imagePath: string
  models: { extract: string; validate: string; escalate: string }
  defaultCurrency: string | null
  log: Log
}): Promise<void> {
  const { supabase, scanId, roomId, userId, imagePath, log } = args
  const startedAt = Date.now()
  try {
    const { base64, mime, bytes } = await downloadImageBase64(supabase, imagePath, log)
    if (bytes > 6 * 1024 * 1024) {
      throw new Error(`Image too large (${bytes} bytes; limit 6MB after decode)`)
    }
    log.step('pipeline:start', { scanId, base64_chars: base64.length })

    const { parsed, passes } = await runPipeline({
      ...args,
      imageBase64: base64,
      imageMime: mime,
    })

    // Load room data once more for resolve — buildCatalog already pulled it,
    // but we want fresh data after the model run too (cheap and keeps the
    // duplicate check up to date). One extra query is fine.
    const room = await loadRoomData(supabase, roomId)
    const { prefill, duplicateOfExpenseId } = resolveMatches(parsed, room)
    const totalCost = passes.reduce((sum, p) => sum + (p.cost_usd ?? 0), 0)

    log.step('pipeline:done', {
      scanId,
      ms: Date.now() - startedAt,
      passes: passes.map(p => p.pass),
      total_cost_usd: totalCost,
      duplicate_of_expense_id: duplicateOfExpenseId,
    })

    const { error: updErr } = await supabase
      .from('pending_receipt_scans')
      .update({
        status: 'ready',
        parsed_payload: parsed,
        prefill_payload: prefill,
        duplicate_of_expense_id: duplicateOfExpenseId,
        cost_usd: totalCost,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId)
    if (updErr) {
      log.error('row:update_ready_failed', { error: updErr.message })
    }

    // Log each pass into ai_usage_log so the rate-limiter sees the real cost.
    for (const p of passes) {
      const { error } = await supabase.from('ai_usage_log').insert({
        user_id: userId,
        room_id: roomId,
        function_name: 'start-receipt-scan',
        model: p.model,
        pass: p.pass,
        cost_usd: p.cost_usd,
      })
      if (error) log.warn('usage_log:insert_failed', { pass: p.pass, error: error.message })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('pipeline:failed', { scanId, error: msg })
    await supabase
      .from('pending_receipt_scans')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const log = new Log('start-receipt-scan', shortId())
  log.step('request:start', { method: req.method, url: req.url })

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
    log.error('env:missing')
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
    log.warn('auth:invalid_token', { error: authError?.message ?? null })
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
  log.step('auth:ok', { user_id: userId })

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!body.scanId || typeof body.scanId !== 'string') {
    return new Response(JSON.stringify({ ok: false, error: 'Missing scanId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  log.step('body:received', { scanId: body.scanId, force: !!body.force })

  // Rate-limit by user — same cap as ocr-receipt. We count rows under
  // ai_usage_log; one scan inserts ~3 rows (one per pass) which is consistent
  // with how the sync flow accounted for cost. Per-minute cap effectively
  // means "no more than ~6 scans/min".
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [{ count: perMin }, { count: perDay }] = await Promise.all([
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', minuteAgo),
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', dayAgo),
  ])
  if ((perMin ?? 0) >= LIMIT_PER_MINUTE) {
    log.warn('rate_limit:hit', { scope: 'minute' })
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'minute' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if ((perDay ?? 0) >= LIMIT_PER_DAY) {
    log.warn('rate_limit:hit', { scope: 'day' })
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', scope: 'day' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: row, error: rowErr } = await supabase
    .from('pending_receipt_scans')
    .select('id, room_id, status, image_storage_path, image_mime, processing_started_at')
    .eq('id', body.scanId)
    .maybeSingle()
  if (rowErr || !row) {
    log.warn('row:not_found', { error: rowErr?.message ?? null })
    return new Response(JSON.stringify({ ok: false, error: 'Scan not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const scan = row as PendingRow

  // Decide whether this invocation is allowed to claim the row.
  const orphanCutoff = Date.now() - ORPHAN_PROCESSING_MINUTES * 60_000
  const isOrphanedProcessing =
    scan.status === 'processing'
    && scan.processing_started_at !== null
    && Date.parse(scan.processing_started_at) < orphanCutoff
  const canClaim =
    scan.status === 'pending'
    || (body.force && (scan.status === 'failed' || isOrphanedProcessing))
  if (!canClaim) {
    log.warn('row:wrong_status', { status: scan.status, force: !!body.force })
    return new Response(JSON.stringify({ ok: false, error: `Scan is ${scan.status}` }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Atomically transition to processing. Use status+id as a guard so two
  // concurrent invocations can't both claim the same row.
  const claimQuery = supabase
    .from('pending_receipt_scans')
    .update({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', scan.id)
  const { error: claimErr } = body.force
    ? await claimQuery.in('status', ['failed', 'processing'])
    : await claimQuery.eq('status', 'pending')
  if (claimErr) {
    log.error('row:claim_failed', { error: claimErr.message })
    return new Response(JSON.stringify({ ok: false, error: 'Failed to claim scan' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve AI model settings for the room. Fall back to sane defaults if the
  // room doesn't have a row yet (matches AiSettingsContext defaults).
  const { data: aiRow } = await supabase
    .from('room_ai_settings')
    .select('model_extract, model_validate, model_escalate')
    .eq('room_id', scan.room_id)
    .maybeSingle()
  const models = {
    extract: aiRow?.model_extract || 'google/gemini-2.5-flash',
    validate: aiRow?.model_validate || 'openai/gpt-5-mini',
    escalate: aiRow?.model_escalate || 'google/gemini-2.5-flash',
  }
  log.step('models:resolved', models)

  const pipeline = processScan({
    supabase,
    openrouterKey,
    scanId: scan.id,
    roomId: scan.room_id,
    userId,
    imagePath: scan.image_storage_path,
    models,
    defaultCurrency: 'BYN',
    log,
  })

  // EdgeRuntime.waitUntil keeps the worker alive after the response is sent.
  // Local CLI (`supabase functions serve`) may not expose it — fall through
  // to await for predictable local testing.
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(pipeline)
    log.step('request:accepted', { scanId: scan.id })
    return new Response(JSON.stringify({ ok: true, scanId: scan.id }), {
      status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } else {
    log.warn('runtime:no_waitUntil', 'falling back to inline await for local serve')
    await pipeline
    return new Response(JSON.stringify({ ok: true, scanId: scan.id, inline: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
