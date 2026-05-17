import { supabase } from '../supabase/client'

export interface ParsedReceiptItem {
  name: string
  amount: number
  packageVolume?: string
  manufacturer?: string
}

export interface ItemMatch {
  itemIndex: number
  /** Short readable name (no codes/sizes). Always provided by the model:
   * either a verbatim entry from catalog.productNames or a generalized
   * label like "Футболка женская". Use this as the item's display name. */
  cleanedName: string
  /** Set only if cleanedName comes verbatim from catalog.productNames AND
   * it is the same product. Client resolves to a real product/purchase id. */
  productName: string | null
  /** Codes / sizes / article numbers stripped from the raw item name. */
  variety: string | null
  /** Confidence that productName (when non-null) is the same item. */
  confidence: number
}

export interface ReceiptMatches {
  items: ItemMatch[]
  /** Best label for this expense — either picked from catalog.expenseLabels
   * or generated (1-3 words in the user's style). Used as a pre-fill. */
  expenseLabel: string | null
  /** Picked verbatim from catalog.categoryNames, or null. */
  expenseCategoryName: string | null
}

export interface ParsedReceipt {
  store?: { name: string; address?: string }
  date?: string
  currency: string
  total?: number
  items: ParsedReceiptItem[]
  confidence: number
  needsEscalation: boolean
  /** Populated by the validate pass when a catalog is provided. */
  matches?: ReceiptMatches | null
}

/**
 * Names-only catalog. Just the user's unique strings — no IDs, no raw
 * rows. The client resolves the names the model returns back to RxDB
 * ids and runs duplicate-detection locally.
 */
export interface OcrCatalog {
  productNames: string[]
  categoryNames: string[]
  storeNames: string[]
  expenseLabels: string[]
}

export type Pass = 'extract' | 'validate' | 'escalate'

export interface PipelineSettings {
  modelExtract: string
  modelValidate: string
  modelEscalate: string
  defaultCurrency?: string
}

export interface PipelineCallbacks {
  onPass?: (pass: Pass) => void
}

export class OcrError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'OcrError'
    this.code = code
  }
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

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
  if (!data.session) throw new OcrError('Не авторизованы', 'unauthorized')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.session.access_token}`,
  }
}

interface OcrApiBody {
  pass: Pass
  model: string
  imageBase64?: string
  imageMimeType?: string
  previousJson?: ParsedReceipt
  currency?: string
  catalog?: OcrCatalog
}

async function callOcr(body: OcrApiBody, signal: AbortSignal): Promise<ParsedReceipt> {
  const headers = await authHeader()
  const res = await fetch(`${FUNCTIONS_URL}/ocr-receipt`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  let parsed: { ok: boolean; json?: ParsedReceipt; error?: string; scope?: string }
  try {
    parsed = await res.json()
  } catch {
    throw new OcrError(`Сервер вернул не-JSON (HTTP ${res.status})`, 'bad_response')
  }

  if (!res.ok || !parsed.ok) {
    if (res.status === 429) {
      const scope = parsed.scope === 'day' ? 'на сегодня' : 'на минуту'
      throw new OcrError(`Лимит запросов исчерпан ${scope}. Попробуйте позже.`, 'rate_limited')
    }
    if (res.status === 401) {
      throw new OcrError('Сессия истекла. Войдите снова.', 'unauthorized')
    }
    throw new OcrError(parsed.error || `Ошибка сервера (HTTP ${res.status})`, 'server_error')
  }

  if (!parsed.json) throw new OcrError('Сервер вернул пустой ответ', 'empty')
  return parsed.json
}

/**
 * Convert a Blob to base64 (without the `data:...;base64,` prefix).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new OcrError('Не удалось прочитать изображение', 'read_failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Resize an image blob to fit within `maxSide` pixels and re-encode as JPEG.
 * Returns the original blob if it is already smaller and JPEG-encoded.
 */
export async function resizeImage(blob: Blob, maxSide = 2048, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) return blob

  const { width, height } = bitmap
  const scale = Math.min(1, maxSide / Math.max(width, height))
  if (scale === 1 && blob.type === 'image/jpeg') {
    bitmap.close()
    return blob
  }

  const targetW = Math.round(width * scale)
  const targetH = Math.round(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return blob
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  return await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', quality)
  })
}

export interface RunPipelineOptions {
  /** If true, always run escalate even when validate didn't flag it. */
  forceEscalate?: boolean
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal
  /**
   * Compact user catalog sent to the validate pass so the model can match
   * receipt items to existing products / categories / expenses with its own
   * confidence scores. When omitted, matches will come from local heuristics
   * only.
   */
  catalog?: OcrCatalog
}

/**
 * Run extract → validate → (escalate if needed) and return the final parsed
 * receipt. Each step gets ~30 s of its own; the caller can pass a wider
 * AbortSignal to cap the total.
 */
export async function runOcrPipeline(
  imageBlob: Blob,
  settings: PipelineSettings,
  callbacks: PipelineCallbacks = {},
  opts: RunPipelineOptions = {},
): Promise<ParsedReceipt> {
  const resized = await resizeImage(imageBlob)
  const base64 = await blobToBase64(resized)
  const mime = resized.type || 'image/jpeg'

  const makeStepSignal = (timeoutMs: number): AbortSignal => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    if (opts.signal) {
      if (opts.signal.aborted) ac.abort()
      else opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
    }
    void t
    return ac.signal
  }

  callbacks.onPass?.('extract')
  let result = await callOcr({
    pass: 'extract',
    model: settings.modelExtract,
    imageBase64: base64,
    imageMimeType: mime,
    currency: settings.defaultCurrency,
  }, makeStepSignal(60_000))

  callbacks.onPass?.('validate')
  try {
    // Validate uses a reasoning model (gpt-5-mini) and can spend 30-60s on
    // reasoning tokens alone. 120s gives comfortable headroom.
    result = await callOcr({
      pass: 'validate',
      model: settings.modelValidate,
      previousJson: result,
      catalog: opts.catalog,
    }, makeStepSignal(120_000))
  } catch (err) {
    // Validation failures shouldn't kill the whole flow — we still have the
    // extract result, which is the most important piece.
    console.warn('OCR validate pass failed, using extract result:', err)
  }

  if (opts.forceEscalate || result.needsEscalation) {
    callbacks.onPass?.('escalate')
    try {
      result = await callOcr({
        pass: 'escalate',
        model: settings.modelEscalate,
        imageBase64: base64,
        imageMimeType: mime,
        currency: settings.defaultCurrency,
      }, makeStepSignal(60_000))
    } catch (err) {
      console.warn('OCR escalate pass failed, using validated result:', err)
    }
  }

  return result
}
