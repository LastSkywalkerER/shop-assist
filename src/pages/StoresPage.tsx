import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { StoreDocument, PurchaseDocument } from '../db/types'
import { Input } from '../components/shared/Input'
import { ConfirmModal } from '../components/shared/ConfirmModal'
import { showBackButton } from '../telegram/backButton'

export function StoresPage() {
  const navigate = useNavigate()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StoreDocument | null>(null)

  useEffect(() => {
    return showBackButton(() => navigate('/'))
  }, [navigate])

  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')
  const stores = useRxQuery(storesCol)
  const purchases = useRxQuery(purchasesCol)

  const purchaseCountMap = new Map<string, number>()
  for (const p of purchases) {
    purchaseCountMap.set(p.storeId, (purchaseCountMap.get(p.storeId) ?? 0) + 1)
  }

  const sorted = [...stores].sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const handleDeleteRequest = (store: StoreDocument) => {
    const count = purchaseCountMap.get(store.id) ?? 0
    if (count > 0) {
      setDeleteTarget(store)
    } else {
      doDelete(store)
    }
  }

  const doDelete = async (store: StoreDocument) => {
    if (!storesCol) return
    const doc = await storesCol.findOne(store.id).exec()
    if (doc) await doc.remove()
    setDeleteTarget(null)
  }

  return (
    <div className="pb-10">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Магазины</h2>
        <button
          onClick={() => navigate('/')}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      <div className="px-4 pb-2">
        <span className="text-[13px] text-text-hint">
          Всего: {stores.length}
        </span>
      </div>

      {stores.length === 0 ? (
        <div className="mx-4 bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
          Нет магазинов
        </div>
      ) : (
        <div className="mx-4 flex flex-col gap-3">
          {sorted.map((store) => {
            const count = purchaseCountMap.get(store.id) ?? 0

            if (editingId === store.id && storesCol) {
              return (
                <StoreEditCard
                  key={store.id}
                  store={store}
                  collection={storesCol}
                  onDone={() => setEditingId(null)}
                />
              )
            }

            return (
              <div key={store.id} className="bg-surface rounded-2xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium text-text">{store.name}</div>
                    {(store.type || store.address) && (
                      <div className="text-[12px] text-text-hint mt-0.5">
                        {[store.type === 'market' ? 'Рынок' : store.type === 'store' ? 'Магазин' : null, store.address].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div className="text-[11px] text-text-hint/60 mt-1">
                      {count > 0 ? `${count} покупок` : 'Нет покупок'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingId(store.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-full active:bg-primary/10 transition-colors"
                      title="Редактировать"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-text">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteRequest(store)}
                      className="w-8 h-8 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                      title="Удалить"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Удалить магазин?"
          message={`У магазина «${deleteTarget.name}» есть ${purchaseCountMap.get(deleteTarget.id) ?? 0} покупок. Они останутся, но без привязки к магазину.`}
          confirmLabel="Удалить"
          destructive
          onConfirm={() => doDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

interface StoreEditCardProps {
  store: StoreDocument
  collection: import('rxdb').RxCollection<StoreDocument>
  onDone: () => void
}

function StoreEditCard({ store, collection, onDone }: StoreEditCardProps) {
  const [name, setName] = useState(store.name)
  const [type, setType] = useState<'market' | 'store' | ''>(store.type ?? '')
  const [address, setAddress] = useState(store.address ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const doc = await collection.findOne(store.id).exec()
      if (doc) {
        await doc.patch({
          name: name.trim(),
          type: type || undefined,
          address: address.trim() || undefined,
          updatedAt: new Date().toISOString(),
        })
      }
      onDone()
    } catch (err) {
      console.error('Failed to update store:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface rounded-2xl p-4 space-y-3">
      <div className="text-[13px] text-section-header font-medium pl-1">
        Редактирование
      </div>
      <Input
        label="Название"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Название магазина"
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Тип</label>
        <div className="flex gap-2">
          {([['store', 'Магазин'], ['market', 'Рынок']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setType(type === val ? '' : val)}
              className={`flex-1 py-2.5 rounded-xl text-[15px] font-medium transition-all ${
                type === val
                  ? 'bg-primary text-on-primary'
                  : 'bg-bg-secondary text-text active:bg-separator/30'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Input
        label="Адрес"
        value={address}
        onChange={(e) => setAddress(e.currentTarget.value)}
        placeholder="Город, улица, дом"
      />
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
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
