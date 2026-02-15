import { useState } from 'react'
import { Rating } from '../shared/Rating'
import type { PurchaseDocument } from '../../db/types'
import type { RxCollection } from 'rxdb'

interface EditPurchaseProps {
  purchase: PurchaseDocument
  collection: RxCollection<PurchaseDocument>
  onDone: () => void
}

export function EditPurchase({ purchase, collection, onDone }: EditPurchaseProps) {
  const [rating, setRating] = useState<number | undefined>(purchase.qualityRating)
  const [notes, setNotes] = useState(purchase.notes ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const doc = await collection.findOne(purchase.id).exec()
      if (doc) {
        await doc.patch({
          qualityRating: rating || undefined,
          notes: notes.trim() || undefined,
          updatedAt: new Date().toISOString(),
        })
      }
      onDone()
    } catch (err) {
      console.error('Failed to update purchase:', err)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    rating !== purchase.qualityRating || notes.trim() !== (purchase.notes ?? '')

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      <div className="text-[13px] text-section-header font-medium pl-1">
        Редактирование
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[13px] text-section-header font-medium pl-1">Оценка качества</label>
        <div className="flex items-center justify-between">
          <Rating value={rating} onChange={(v) => setRating(v === 0 ? undefined : v)} />
          {rating && (
            <span className="text-[13px] text-text-hint">{rating} из 5</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Комментарий</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Заметка о покупке..."
          rows={2}
          className="bg-bg-secondary rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="flex-1 bg-primary text-on-primary py-2.5 rounded-xl font-medium text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button
          onClick={onDone}
          className="px-5 py-2.5 text-primary-text text-[15px] font-medium rounded-xl active:bg-primary/10 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
