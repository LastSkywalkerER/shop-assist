import { useCallback, useEffect, useRef, useState } from 'react'
import { createBarcodeScanner, type BarcodeScanner } from '../../lib/barcode/detector'
import { useCameraControls, type FocusRingState } from '../../lib/camera/useCameraControls'
import { FocusRing } from '../../lib/camera/FocusRing'
import { ManualBarcodeInput } from './ManualBarcodeInput'

interface BarcodeScannerModalProps {
  onDetected: (barcode: string) => void
  onCancel: () => void
}

type ScannerState =
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'manual' }
  | { kind: 'error'; message: string; telegramHint?: boolean }

function isTelegramWebView(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp
}

export function BarcodeScannerModal({ onDetected, onCancel }: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<BarcodeScanner | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const resolvedRef = useRef(false)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [track, setTrack] = useState<MediaStreamTrack | null>(null)
  const [state, setState] = useState<ScannerState>({ kind: 'starting' })
  const [focusRing, setFocusRing] = useState<FocusRingState | null>(null)

  const { torchSupported, torchOn, toggleTorch, focusAt, tapFocusSupported } = useCameraControls(
    track,
    videoEl,
  )

  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
  }, [])

  const handleDetected = (barcode: string) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    navigator.vibrate?.(40)
    stopCamera()
    onDetected(barcode)
  }

  const stopCamera = () => {
    scannerRef.current?.stop()
    scannerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setTrack(null)
    setFocusRing(null)
  }

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException('Camera API unavailable', 'NotSupportedError')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        setTrack(stream.getVideoTracks()[0] ?? null)

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.setAttribute('playsinline', 'true')
        await video.play().catch(() => {})

        const scanner = await createBarcodeScanner()
        if (cancelled) return
        scannerRef.current = scanner
        setState({ kind: 'running' })
        await scanner.start(video, handleDetected)
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string })?.name ?? ''
        let message = 'Не удалось включить камеру.'
        let telegramHint = false
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          message = 'Доступ к камере не разрешён. Разрешите его в настройках браузера.'
          telegramHint = isTelegramWebView()
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          message = 'Камера не найдена на устройстве.'
        } else if (name === 'NotReadableError') {
          message = 'Камера занята другим приложением.'
        } else if (name === 'NotSupportedError') {
          message = 'Браузер не поддерживает доступ к камере. Проверьте, что страница открыта по HTTPS.'
        }
        stopCamera()
        setState({ kind: 'error', message, telegramHint })
      }
    }

    start()
    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVideoTap = (e: React.PointerEvent<HTMLVideoElement>) => {
    if (!tapFocusSupported) return
    const cx = e.clientX
    const cy = e.clientY
    void (async () => {
      const ring = await focusAt(cx, cy)
      if (!ring) return
      setFocusRing(ring)
      window.setTimeout(() => {
        setFocusRing((cur) => (cur?.id === ring.id ? null : cur))
      }, 700)
    })()
  }

  if (state.kind === 'manual') {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
        <ManualBarcodeInput
          onSubmit={(code) => {
            resolvedRef.current = true
            stopCamera()
            onDetected(code)
          }}
          onCancel={() => setState({ kind: 'running' })}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="absolute inset-0">
        <video
          ref={setVideo}
          muted
          playsInline
          autoPlay
          onPointerDown={handleVideoTap}
          className="w-full h-full object-cover"
          style={{ touchAction: 'manipulation' }}
        />
        {state.kind === 'running' && <FocusRing ring={focusRing} />}
      </div>

      {/* Scan window overlay */}
      {state.kind === 'running' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-[80%] aspect-[16/9] max-w-md relative">
            <div className="absolute inset-0 border-2 border-white/80 rounded-2xl" />
            <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-2xl" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-2xl" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-2xl" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-2xl" />
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-primary/80 scanline" />
          </div>
        </div>
      )}

      {state.kind === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/80 text-[14px]">Запуск камеры…</div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-6">
          <div className="bg-surface rounded-2xl p-5 w-full max-w-sm space-y-3">
            <div className="text-[17px] font-semibold text-text">Камера недоступна</div>
            <div className="text-[13px] text-text-hint leading-snug">{state.message}</div>
            {state.telegramHint && (
              <div className="text-[12px] text-text-hint leading-snug">
                Подсказка: откройте приложение во внешнем браузере через меню Telegram (три точки).
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onCancel}
                className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
              >
                Закрыть
              </button>
              <button
                onClick={() => setState({ kind: 'manual' })}
                className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] active:opacity-80 transition-opacity"
              >
                Ввести вручную
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
        <div className="text-white/90 text-[15px] font-medium bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
          Штрих-код
        </div>
        <button
          onClick={onCancel}
          aria-label="Закрыть"
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center active:bg-black/60 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      {(state.kind === 'running' || state.kind === 'starting') && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 flex items-center justify-center gap-3 z-10">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              aria-label="Фонарик"
              className={`w-12 h-12 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                torchOn ? 'bg-primary text-on-primary' : 'bg-black/40 text-white active:bg-black/60'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6.5 17.5a2.12 2.12 0 0 0 3 3L21 9ZM15 5l4 4" />
                <path d="m14.5 12.5-2-2" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setState({ kind: 'manual' })}
            className="bg-black/40 backdrop-blur-sm text-white text-[14px] font-medium rounded-full px-4 py-3 active:bg-black/60 transition-colors"
          >
            Ввести вручную
          </button>
        </div>
      )}

      <style>{`
        @keyframes scanline-move {
          0% { transform: translateY(-80%); opacity: 0.2; }
          50% { opacity: 0.9; }
          100% { transform: translateY(80%); opacity: 0.2; }
        }
        .scanline {
          animation: scanline-move 2s ease-in-out infinite;
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.8);
        }
      `}</style>
    </div>
  )
}
