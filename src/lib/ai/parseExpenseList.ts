// Client helper for the synchronous bulk expense-list parser. Sends an image,
// PDF, or pasted text to the `parse-expense-list` edge function and returns the
// extracted rows (with label/category matches the model found against the
// user's known labels). See docs/AI_FEATURE_NOTES.md → "Bulk expense list".

import { supabase } from '../supabase/client'
import { resizeImage } from './ocrPipeline'

export interface ParsedExpenseRow {
  date: string | null
  name: string
  amount: number
  currency: string | null
  matchedLabel: string | null
  categoryName: string | null
  confidence: number
}

export type ParseExpenseListInput =
  | { kind: 'image'; blob: Blob }
  | { kind: 'pdf'; blob: Blob; filename?: string }
  | { kind: 'text'; text: string }

export interface ParseExpenseListArgs {
  input: ParseExpenseListInput
  model: string
  currency?: string
  labels?: string[]
  categoryNames?: string[]
}

export interface ParseExpenseListResult {
  currency: string
  rows: ParsedExpenseRow[]
  costUsd: number | null
}

export class ParseExpenseListError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ParseExpenseListError'
    this.code = code
  }
}

function functionsUrl(path: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`
}

async function authHeader(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession()
  if (data.session) {
    try {
      const payload = JSON.parse(atob(data.session.access_token.split('.')[1]))
      if (payload.exp * 1000 - Date.now() < 60_000) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (refreshed.session) data = refreshed
      }
    } catch {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session) data = refreshed
    }
  }
  if (!data.session) throw new ParseExpenseListError('Не авторизованы', 'unauthorized')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.session.access_token}`,
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function parseExpenseList(
  { input, model, currency, labels, categoryNames }: ParseExpenseListArgs,
): Promise<ParseExpenseListResult> {
  let payloadInput: Record<string, unknown>
  if (input.kind === 'text') {
    if (!input.text.trim()) throw new ParseExpenseListError('Пустой список', 'empty')
    payloadInput = { kind: 'text', text: input.text }
  } else if (input.kind === 'image') {
    const resized = await resizeImage(input.blob)
    payloadInput = { kind: 'image', base64: await blobToBase64(resized), mime: resized.type || 'image/jpeg' }
  } else {
    payloadInput = {
      kind: 'pdf',
      base64: await blobToBase64(input.blob),
      mime: 'application/pdf',
      filename: input.filename || 'expenses.pdf',
    }
  }

  const headers = await authHeader()
  const res = await fetch(functionsUrl('parse-expense-list'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: payloadInput, currency, labels, categoryNames }),
  })

  if (!res.ok) {
    let parsed: { error?: string; scope?: string } = {}
    try { parsed = await res.json() } catch { /* ignore */ }
    if (parsed.error === 'rate_limited') {
      throw new ParseExpenseListError(
        parsed.scope === 'minute' ? 'Слишком часто — попробуйте через минуту' : 'Дневной лимит распознаваний исчерпан',
        'rate_limited',
      )
    }
    throw new ParseExpenseListError(parsed.error || `Ошибка распознавания (HTTP ${res.status})`, 'request_failed')
  }

  const json = await res.json() as { ok?: boolean; currency?: string; rows?: ParsedExpenseRow[]; costUsd?: number | null; error?: string }
  if (!json.ok || !Array.isArray(json.rows)) {
    throw new ParseExpenseListError(json.error || 'Пустой ответ распознавания', 'bad_response')
  }
  return {
    currency: json.currency || currency || 'BYN',
    rows: json.rows,
    costUsd: json.costUsd ?? null,
  }
}
