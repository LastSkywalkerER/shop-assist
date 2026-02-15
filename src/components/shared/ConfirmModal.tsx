import { useEffect, useRef } from 'react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  destructive,
  confirmDisabled,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onCancel()
      }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
    >
      <div className="bg-surface rounded-2xl w-full max-w-[300px] overflow-hidden">
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="text-[17px] font-semibold text-text mb-1">{title}</div>
          <div className="text-[13px] text-text-hint leading-snug">{message}</div>
        </div>
        <div className="border-t border-separator/30 flex">
          <button
            onClick={onCancel}
            className="flex-1 py-3 text-[15px] font-medium text-primary-text active:bg-bg-secondary transition-colors border-r border-separator/30"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 py-3 text-[15px] font-semibold active:bg-bg-secondary transition-colors disabled:opacity-50 disabled:pointer-events-none ${
              destructive ? 'text-destructive' : 'text-primary-text'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
