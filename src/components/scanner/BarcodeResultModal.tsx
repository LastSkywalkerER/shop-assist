import { useEffect, useRef } from 'react'
import type { LookupResult } from '../../lib/barcode/lookup'

interface BarcodeResultModalProps {
  result: LookupResult
  saving?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function BarcodeResultModal({ result, saving, onConfirm, onCancel }: BarcodeResultModalProps) {
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
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    >
      <div className="bg-surface rounded-2xl w-full max-w-sm overflow-hidden">
        {result.imageUrl && (
          <div className="bg-bg-secondary flex items-center justify-center p-4">
            <img
              src={result.imageUrl}
              alt=""
              className="max-h-40 object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
        <div className="px-5 pt-4 pb-3 space-y-1.5">
          <div className="text-[11px] font-mono text-text-hint tracking-wider">{result.barcode}</div>
          <div className="text-[17px] font-semibold text-text leading-tight">
            {result.name || 'Товар'}
          </div>
          {result.brand && (
            <div className="text-[13px] text-text-hint">{result.brand}</div>
          )}
          {result.category && (
            <div className="text-[12px] text-text-hint italic">{result.category}</div>
          )}
        </div>
        <div className="border-t border-separator/30 flex">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 text-[15px] font-medium text-primary-text active:bg-bg-secondary transition-colors border-r border-separator/30 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="flex-1 py-3 text-[15px] font-semibold text-primary-text active:bg-bg-secondary transition-colors disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
