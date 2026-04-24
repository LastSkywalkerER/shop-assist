export type BarcodeFormat =
  | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e'
  | 'code_128' | 'code_39' | 'itf'
  | 'qr_code' | 'data_matrix' | 'aztec' | 'pdf417'

export interface BarcodeScanner {
  start(video: HTMLVideoElement, onResult: (barcode: string) => void): Promise<void>
  stop(): void
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string; format: string }>>
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

const NATIVE_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_39', 'itf',
  'qr_code', 'data_matrix', 'aztec', 'pdf417',
]

// Formats that decode to free-form text (URL, GS1 AI string, etc.) — never numeric only.
const FREE_FORM_FORMATS = new Set(['qr_code', 'data_matrix', 'aztec', 'pdf417'])

function hasNativeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

function normalize(raw: string): string {
  return raw.replace(/\D/g, '')
}

function isValidLength(code: string): boolean {
  const len = code.length
  return len === 8 || len === 12 || len === 13 || len === 14
}

function createNativeScanner(): BarcodeScanner {
  const Ctor = (window as unknown as { BarcodeDetector: NativeBarcodeDetectorCtor }).BarcodeDetector
  const detector = new Ctor({ formats: NATIVE_FORMATS })
  let rafId: number | null = null
  let cancelled = false

  return {
    async start(video, onResult) {
      cancelled = false
      const tick = async () => {
        if (cancelled) return
        if (video.readyState >= 2) {
          try {
            const results = await detector.detect(video)
            if (results.length > 0) {
              const raw = results[0].rawValue
              const format = results[0].format
              const isFreeForm = FREE_FORM_FORMATS.has(format)
              const code = isFreeForm ? raw : normalize(raw)
              if (code && (isFreeForm || isValidLength(code))) {
                onResult(code)
                return
              }
            }
          } catch {
            // ignore transient detection errors
          }
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    },
    stop() {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
    },
  }
}

async function createZxingScanner(): Promise<BarcodeScanner> {
  const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  const hints = new Map()
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
    lib.BarcodeFormat.EAN_13,
    lib.BarcodeFormat.EAN_8,
    lib.BarcodeFormat.UPC_A,
    lib.BarcodeFormat.UPC_E,
    lib.BarcodeFormat.CODE_128,
    lib.BarcodeFormat.CODE_39,
    lib.BarcodeFormat.ITF,
    lib.BarcodeFormat.QR_CODE,
    lib.BarcodeFormat.DATA_MATRIX,
    lib.BarcodeFormat.AZTEC,
    lib.BarcodeFormat.PDF_417,
  ])
  hints.set(lib.DecodeHintType.TRY_HARDER, true)
  const FREE_FORM_BF = new Set([
    lib.BarcodeFormat.QR_CODE,
    lib.BarcodeFormat.DATA_MATRIX,
    lib.BarcodeFormat.AZTEC,
    lib.BarcodeFormat.PDF_417,
  ])

  const reader = new BrowserMultiFormatReader(hints)
  let controls: { stop: () => void } | null = null

  return {
    async start(video, onResult) {
      controls = await reader.decodeFromVideoElement(video, (result, _err, ctrl) => {
        if (!result) return
        const raw = result.getText()
        const format = result.getBarcodeFormat()
        const isFreeForm = FREE_FORM_BF.has(format)
        const code = isFreeForm ? raw : normalize(raw)
        if (!code) return
        if (!isFreeForm && !isValidLength(code)) return
        ctrl.stop()
        onResult(code)
      })
    },
    stop() {
      controls?.stop()
      controls = null
    },
  }
}

export async function createBarcodeScanner(): Promise<BarcodeScanner> {
  if (hasNativeDetector()) {
    try {
      return createNativeScanner()
    } catch {
      // fall through to zxing
    }
  }
  return createZxingScanner()
}

export function isValidBarcode(code: string): boolean {
  return /^\d{8,14}$/.test(code)
}
