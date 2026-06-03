import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase/client'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { deletePendingScan, retryScan } from '../../lib/ai/pendingScans'
import type { PendingScan } from '../../hooks/usePendingScans'

// A 'processing' row whose worker likely crashed — must match the edge
// function's ORPHAN_PROCESSING_MINUTES so a forced retry can actually reclaim it.
const ORPHAN_MS = 10 * 60_000
// A row still 'pending' this long means the kickoff request never reached the
// edge function (it flips pending→processing synchronously before responding),
// e.g. the POST failed while offline. Surface retry/delete instead of spinning.
const PENDING_STUCK_MS = 60_000

const BUCKET = 'sync-attachments'

function useThumbnailUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null)
      })
    return () => { cancelled = true }
  }, [path])
  return url
}

interface PendingScanRowProps {
  scan: PendingScan
}

export function PendingScanRow({ scan }: PendingScanRowProps) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const thumbUrl = useThumbnailUrl(scan.image_storage_path)

  // Re-render periodically while in-flight so the "stuck" recovery UI appears
  // on its own, without waiting for a Realtime event to repaint the row.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (scan.status !== 'pending' && scan.status !== 'processing') return
    const t = setInterval(() => forceTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [scan.status])

  const isOrphaned =
    scan.status === 'processing'
    && scan.processing_started_at != null
    && Date.parse(scan.processing_started_at) < Date.now() - ORPHAN_MS
  const isStuckPending =
    scan.status === 'pending'
    && Date.parse(scan.created_at) < Date.now() - PENDING_STUCK_MS
  const isStuck = isOrphaned || isStuckPending

  const handleOpen = () => {
    if (scan.status !== 'ready' || !scan.prefill_payload) return
    navigate('/expenses/add', {
      state: {
        ocrPrefill: {
          ...scan.prefill_payload,
          pendingScanId: scan.id,
          pendingScanStoragePath: scan.image_storage_path,
          pendingScanMime: scan.image_mime,
          duplicateOfExpenseId: scan.duplicate_of_expense_id,
        },
      },
    })
  }

  const handleRetry = async () => {
    if (busy) return
    setBusy(true)
    try {
      await retryScan(scan.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ошибка повтора', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (busy) return
    const ok = await confirm({
      title: 'Удалить распознавание?',
      message: 'Загруженный чек будет удалён без сохранения.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deletePendingScan(scan.id, scan.image_storage_path)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось удалить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const showAsClickable = scan.status === 'ready'

  return (
    <div
      onClick={showAsClickable ? handleOpen : undefined}
      className={`bg-surface rounded-2xl border border-separator/30 p-3 flex items-center gap-3 ${showAsClickable ? 'active:opacity-80 cursor-pointer' : ''}`}
    >
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-xl bg-text/10 overflow-hidden shrink-0 flex items-center justify-center">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text/40">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {(scan.status === 'pending' || scan.status === 'processing') && (
          <>
            <div className="flex items-center gap-2">
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="animate-spin text-primary-text shrink-0"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <div className="text-[15px] font-medium text-text truncate">
                {isStuck ? 'Похоже, что-то зависло' : 'Распознаём чек…'}
              </div>
            </div>
            <div className="text-[12px] text-text-hint mt-0.5 truncate">
              {isStuck ? 'Распознавание не отвечает — попробуйте ещё раз' : 'Можно продолжать работу — мы сообщим, когда будет готово'}
            </div>
            {isStuck && (
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-xl bg-primary text-on-primary text-[13px] font-medium disabled:opacity-50 active:opacity-80"
                >
                  Повторить
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-xl bg-text/5 text-text text-[13px] font-medium disabled:opacity-50 active:opacity-80"
                >
                  Удалить
                </button>
              </div>
            )}
          </>
        )}

        {scan.status === 'ready' && scan.prefill_payload && (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[15px] font-medium text-text truncate min-w-0">
                {scan.prefill_payload.name || scan.prefill_payload.storeName || 'Расход'}
              </div>
            </div>
            <div className="text-[13px] text-text-hint mt-0.5 truncate">
              {scan.prefill_payload.total != null && (
                <span className="text-text font-medium">
                  {scan.prefill_payload.total.toFixed(2)} {scan.prefill_payload.currency}
                </span>
              )}
              {scan.prefill_payload.storeName && (
                <span> · {scan.prefill_payload.storeName}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary-text text-[11px] font-medium">
                Требует подтверждения
              </span>
              {scan.duplicate_of_expense_id && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[11px] font-medium">
                  Возможный дубль
                </span>
              )}
            </div>
          </>
        )}

        {scan.status === 'failed' && (
          <>
            <div className="text-[15px] font-medium text-destructive truncate">
              Не удалось распознать
            </div>
            <div className="text-[12px] text-text-hint mt-0.5 line-clamp-2">
              {scan.error_message || 'Неизвестная ошибка'}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handleRetry}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-primary text-on-primary text-[13px] font-medium disabled:opacity-50 active:opacity-80"
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-text/5 text-text text-[13px] font-medium disabled:opacity-50 active:opacity-80"
              >
                Удалить
              </button>
            </div>
          </>
        )}
      </div>

      {showAsClickable && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text/30 shrink-0">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  )
}
