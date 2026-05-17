import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAiSettings } from '../../contexts/AiSettingsContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useRxQuery, useRxCollection } from '../../db/hooks'
import { ReceiptCameraModal } from './ReceiptCameraModal'
import { runOcrPipeline, OcrError, type Pass } from '../../lib/ai/ocrPipeline'
import { matchPurchaseForItem, matchStore, matchExpenseForReceipt, AUTO_BIND_THRESHOLD } from '../../lib/ai/matching'
import { blobStorePut, addPendingUpload } from '../../db/blobStore'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import type {
  ExpenseDocument,
  StoreDocument,
  ProductDocument,
  PurchaseDocument,
} from '../../db/types'
import type { AttachmentFile } from './FileUpload'
import type { ReceiptItem } from './ReceiptItemsManager'

interface ScanReceiptFlowProps {
  onClose: () => void
}

const PASS_LABELS: Record<Pass, string> = {
  extract: 'Распознавание чека…',
  validate: 'Проверка результата…',
  escalate: 'Уточнение распознавания…',
}

export function ScanReceiptFlow({ onClose }: ScanReceiptFlowProps) {
  const navigate = useNavigate()
  const { settings } = useAiSettings()
  const { showToast } = useToast()
  const confirm = useConfirm() // returns the confirm() function directly

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: products } = useRxQuery(productsCol)
  const { data: purchases } = useRxQuery(purchasesCol)

  const [pass, setPass] = useState<Pass | null>(null)

  const handleCaptured = async (blob: Blob) => {
    if (!settings) {
      showToast('Настройки AI не загружены', 'error')
      onClose()
      return
    }

    setPass('extract')
    let parsed
    try {
      parsed = await runOcrPipeline(
        blob,
        {
          modelExtract: settings.modelExtract,
          modelValidate: settings.modelValidate,
          modelEscalate: settings.modelEscalate,
          defaultCurrency: DEFAULT_CURRENCY,
        },
        { onPass: setPass },
      )
    } catch (err) {
      console.error('OCR pipeline failed:', err)
      const message = err instanceof OcrError ? err.message : 'Ошибка распознавания'
      showToast(message, 'error')
      setPass(null)
      onClose()
      return
    }

    // Persist the captured image to blob store so AddExpense can pick it up
    // via location.state by id (the blob itself can't cross the router).
    const attachmentId = crypto.randomUUID()
    const fileBlob = blob instanceof File
      ? blob
      : new File([blob], `receipt-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
    try {
      await blobStorePut(attachmentId, fileBlob)
      addPendingUpload(attachmentId)
    } catch (err) {
      console.error('Failed to persist receipt image:', err)
      // Continue without the attachment — user can re-attach in the form.
    }

    const matchedStore = matchStore(parsed.store?.name, stores)
    const matchedExpense = matchExpenseForReceipt(parsed, matchedStore?.storeId ?? null, expenses)

    if (matchedExpense && matchedExpense.confidence >= AUTO_BIND_THRESHOLD) {
      const exp = expenses.find((e) => e.id === matchedExpense.expenseId)
      const storeName = exp?.storeId ? stores.find((s) => s.id === exp.storeId)?.name : undefined
      const openExisting = await confirm({
        title: 'Похоже, такой расход уже есть',
        message: `${storeName ?? 'Магазин'} · ${(exp?.amount ?? 0).toFixed(2)} ${exp?.currency ?? ''} · ${exp ? new Date(exp.date).toLocaleDateString('ru-RU') : ''}. Открыть существующий?`,
        confirmLabel: 'Открыть',
        cancelLabel: 'Создать новый',
      })
      if (openExisting && exp) {
        navigate(`/expenses/${exp.id}`)
        onClose()
        return
      }
    }

    // Build prefill payload for AddExpense.
    const items: ReceiptItem[] = parsed.items.map((it) => {
      const match = matchPurchaseForItem(it, products, purchases, matchedStore?.storeId)
      const autoBind = match && match.confidence >= AUTO_BIND_THRESHOLD
      return {
        id: crypto.randomUUID(),
        name: it.name,
        amount: it.amount,
        currency: parsed.currency,
        manufacturer: it.manufacturer,
        packageVolume: it.packageVolume,
        addToProducts: !!autoBind,
        existingPurchaseId: autoBind ? match!.purchaseId : undefined,
      }
    })

    const attachments: AttachmentFile[] = [{
      id: attachmentId,
      fileName: fileBlob.name,
      mimeType: fileBlob.type,
      size: fileBlob.size,
    }]

    // Normalize date to YYYY-MM-DD for <input type="date">.
    let prefilledDate: string | undefined
    if (parsed.date) {
      const t = Date.parse(parsed.date)
      if (!Number.isNaN(t)) prefilledDate = new Date(t).toISOString().split('T')[0]
    }

    navigate('/expenses/add', {
      state: {
        ocrPrefill: {
          storeId: matchedStore?.storeId,
          storeName: parsed.store?.name,
          storeAddress: parsed.store?.address,
          date: prefilledDate,
          currency: parsed.currency,
          total: parsed.total,
          items,
          attachments,
          confidence: parsed.confidence,
        },
      },
    })
    onClose()
  }

  return (
    <ReceiptCameraModal
      onCaptured={handleCaptured}
      onCancel={() => {
        if (pass) return // ignore close while processing
        onClose()
      }}
      processingLabel={pass ? PASS_LABELS[pass] : undefined}
    />
  )
}
