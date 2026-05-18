import { useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'
import { ReceiptCameraModal } from './ReceiptCameraModal'
import { startScan, PendingScanError } from '../../lib/ai/pendingScans'

interface ScanReceiptFlowProps {
  onClose: () => void
}

/**
 * Capture-and-kick-off camera flow. After the user snaps a photo we just
 * upload it and tell the orchestrator to run the OCR pipeline in the
 * background — the resulting pending row appears in ExpensesDashboard's
 * pending section. Status transitions (processing → ready/failed) reach
 * the list via Realtime; no UI here.
 */
export function ScanReceiptFlow({ onClose }: ScanReceiptFlowProps) {
  const { showToast } = useToast()
  const { user, roomId } = useAuth()
  const [busy, setBusy] = useState(false)

  const handleCaptured = async (blob: Blob) => {
    if (!roomId || !user?.id) {
      showToast('Не авторизованы', 'error')
      onClose()
      return
    }
    setBusy(true)
    try {
      await startScan({ blob, roomId, userId: user.id })
      showToast('Чек отправлен на распознавание', 'success')
      onClose()
    } catch (err) {
      const message = err instanceof PendingScanError ? err.message : 'Не удалось отправить чек'
      console.error('Failed to start scan:', err)
      showToast(message, 'error')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReceiptCameraModal
      onCaptured={handleCaptured}
      onCancel={() => { if (!busy) onClose() }}
      processingLabel={busy ? 'Загружаем чек…' : undefined}
    />
  )
}
