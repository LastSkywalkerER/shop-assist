import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraControls, type FocusRingState } from '../../lib/camera/useCameraControls'
import { FocusRing } from '../../lib/camera/FocusRing'

interface ReceiptCameraModalProps {
  onCaptured: (blob: Blob) => void
  onCancel: () => void
  /** When set, overlay a status string on top of the captured preview. */
  processingLabel?: string
}

type CamState =
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'captured'; blob: Blob; url: string }
  | { kind: 'error'; message: string; telegramHint?: boolean }

function isTelegramWebView(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp
}

export function ReceiptCameraModal({ onCaptured, onCancel, processingLabel }: ReceiptCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [track, setTrack] = useState<MediaStreamTrack | null>(null)
  const [state, setState] = useState<CamState>({ kind: 'starting' })
  const [focusRing, setFocusRing] = useState<FocusRingState | null>(null)

  const { torchSupported, torchOn, toggleTorch, focusAt, tapFocusSupported } = useCameraControls(
    track,
    videoEl,
  )

  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
  }, [])

  const stopCamera = () => {
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
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
        setState({ kind: 'running' })
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
          message = 'Браузер не поддерживает доступ к камере. Откройте страницу по HTTPS.'
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
  }, [])

  // Revoke preview object URL when leaving the captured state.
  useEffect(() => {
    return () => {
      if (state.kind === 'captured') URL.revokeObjectURL(state.url)
    }
  }, [state])

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

  const snap = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92))
    if (!blob) return
    stopCamera()
    const url = URL.createObjectURL(blob)
    setState({ kind: 'captured', blob, url })
  }

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    stopCamera()
    const url = URL.createObjectURL(file)
    setState({ kind: 'captured', blob: file, url })
  }

  const confirmCaptured = () => {
    if (state.kind !== 'captured') return
    onCaptured(state.blob)
  }

  const retake = async () => {
    setState({ kind: 'starting' })
    // Re-run the start effect by remounting the video: easier — just call the
    // same initialization inline.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      setTrack(stream.getVideoTracks()[0] ?? null)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => {})
      }
      setState({ kind: 'running' })
    } catch {
      setState({ kind: 'error', message: 'Не удалось перезапустить камеру.' })
    }
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Video / preview */}
      <div className="absolute inset-0">
        {state.kind === 'captured' ? (
          <img src={state.url} alt="Снимок" className="w-full h-full object-contain bg-black" />
        ) : (
          <video
            ref={setVideo}
            muted
            playsInline
            autoPlay
            onPointerDown={handleVideoTap}
            className="w-full h-full object-cover"
            style={{ touchAction: 'manipulation' }}
          />
        )}
        {state.kind === 'running' && <FocusRing ring={focusRing} />}
      </div>

      {/* Frame overlay for running camera */}
      {state.kind === 'running' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-[85%] aspect-[3/4] max-w-md max-h-[70vh] relative">
            <div className="absolute inset-0 border-2 border-white/70 rounded-2xl" />
            <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-2xl" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-2xl" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-2xl" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-2xl" />
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
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] active:opacity-80 transition-opacity"
              >
                Выбрать из галереи
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
        <div className="text-white/90 text-[15px] font-medium bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
          {state.kind === 'captured' ? 'Снимок чека' : 'Фото чека'}
        </div>
        <button
          onClick={onCancel}
          aria-label="Закрыть"
          disabled={!!processingLabel}
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center active:bg-black/60 transition-colors disabled:opacity-40"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      {state.kind === 'running' && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 flex items-center justify-between gap-3 z-10">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Из галереи"
            className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center active:bg-black/60 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </button>

          <button
            type="button"
            onClick={snap}
            aria-label="Снять"
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full border-2 border-black" />
          </button>

          {torchSupported ? (
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
          ) : (
            <div className="w-12 h-12" />
          )}
        </div>
      )}

      {state.kind === 'captured' && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 z-10">
          {processingLabel ? (
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-4 py-3 flex items-center gap-3 text-white">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <div className="text-[14px]">{processingLabel}</div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={retake}
                className="flex-1 bg-black/50 backdrop-blur-sm text-white py-3 rounded-2xl font-medium text-[15px] active:bg-black/70"
              >
                Переснять
              </button>
              <button
                onClick={confirmCaptured}
                className="flex-1 bg-primary text-on-primary py-3 rounded-2xl font-semibold text-[15px] active:opacity-80"
              >
                Использовать
              </button>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFilePicked}
      />
    </div>
  )
}
