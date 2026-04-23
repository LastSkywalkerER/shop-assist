import { BarcodeScannerModal } from './BarcodeScannerModal'
import { BarcodeResultModal } from './BarcodeResultModal'
import { ProductForm } from '../purchase/ProductForm'
import type { ScanFlowStage } from '../../hooks/useBarcodeScanFlow'
import type { LookupResult } from '../../lib/barcode/lookup'

interface ScannerFlowProps {
  stage: ScanFlowStage
  saving: boolean
  categories: string[]
  onDetected: (barcode: string) => void
  onCancel: () => void
  onConfirmLookup: () => void
  onRejectLookup: () => void
  onCreateManual: (data: { name: string; category?: string; barcode?: string; brand?: string; lookup?: LookupResult }) => void
}

export function ScannerFlow({
  stage,
  saving,
  categories,
  onDetected,
  onCancel,
  onConfirmLookup,
  onRejectLookup,
  onCreateManual,
}: ScannerFlowProps) {
  if (stage.kind === 'idle') return null

  if (stage.kind === 'scanning') {
    return <BarcodeScannerModal onDetected={onDetected} onCancel={onCancel} />
  }

  if (stage.kind === 'lookup') {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
        <div className="text-white/90 text-[14px]">Ищем товар по штрих-коду…</div>
        <div className="text-white/60 text-[12px] font-mono">{stage.barcode}</div>
      </div>
    )
  }

  if (stage.kind === 'result') {
    return (
      <BarcodeResultModal
        result={stage.lookup}
        saving={saving}
        onConfirm={onConfirmLookup}
        onCancel={onRejectLookup}
      />
    )
  }

  // manual
  const hintText =
    stage.hint === 'offline'
      ? 'Нет связи с базой. Введите название вручную.'
      : 'Товар не найден в базе. Введите название вручную.'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-2 px-1 text-[13px] text-white/80">{hintText}</div>
        <ProductForm
          categories={categories}
          barcode={stage.barcode || undefined}
          onSave={(data) => onCreateManual({ ...data, barcode: stage.barcode || undefined })}
          onCancel={onCancel}
        />
      </div>
    </div>
  )
}
