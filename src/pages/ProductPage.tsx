import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument } from '../db/types'
import { Rating } from '../components/shared/Rating'
import { ConfirmModal } from '../components/shared/ConfirmModal'
import { EditPurchase } from '../components/purchase/EditPurchase'
import { EditProduct } from '../components/purchase/EditProduct'
import { showBackButton } from '../telegram/backButton'

export function ProductPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingProduct, setEditingProduct] = useState(false)
  const [confirmState, setConfirmState] = useState<null | { type: 'purchase'; purchase: PurchaseDocument } | { type: 'product' }>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)

  useEffect(() => {
    return showBackButton(() => navigate('/'))
  }, [navigate])

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const products = useRxQuery(productsCol)
  const stores = useRxQuery(storesCol)
  const purchases = useRxQuery(purchasesCol)

  const product = useMemo(() => products.find((p) => p.id === id), [products, id])
  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores])

  const productPurchases = useMemo(
    () =>
      purchases
        .filter((p) => p.productId === id)
        .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
    [purchases, id],
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const handleDeleteProduct = async () => {
    if (!productsCol || productPurchases.length > 0) return
    setDeletingProduct(true)
    try {
      const doc = await productsCol.findOne(id).exec()
      if (doc) {
        await doc.remove()
      }
      setConfirmState(null)
      navigate('/')
    } catch (err) {
      console.error('Failed to delete product:', err)
    } finally {
      setDeletingProduct(false)
    }
  }

  const handleDeletePurchase = async (purchase: PurchaseDocument) => {
    if (!purchasesCol) return
    const doc = await purchasesCol.findOne(purchase.id).exec()
    if (doc) await doc.remove()
    setConfirmState(null)
  }

  if (!product) {
    return (
      <div className="p-4 text-text-hint text-[15px]">Продукт не найден</div>
    )
  }

  const subtitle = [product.manufacturer, product.packageVolume, product.category].filter(Boolean).join(' · ')

  return (
    <div className="pb-10">
      {/* Product header */}
      {editingProduct && productsCol ? (
        <div className="p-4 pb-2">
          <EditProduct
            product={product}
            collection={productsCol}
            categories={categories}
            onDone={() => setEditingProduct(false)}
          />
        </div>
      ) : (
        <div
          className="p-4 pb-2 active:bg-bg-secondary/30 transition-colors cursor-pointer"
          onClick={() => setEditingProduct(true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h2 className="text-[20px] font-bold text-text truncate">{product.name}</h2>
              <svg className="text-text-hint/40 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); navigate('/') }}
              className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity shrink-0 ml-2"
            >
              Назад
            </button>
          </div>
          {subtitle && (
            <div className="text-[13px] text-text-hint mt-0.5">{subtitle}</div>
          )}
        </div>
      )}

      {/* Purchases header */}
      <div className="px-4 pt-3 pb-2">
        <span className="text-[13px] text-section-header font-medium">
          Покупки ({productPurchases.length})
        </span>
      </div>

      {/* Purchases list */}
      {productPurchases.length === 0 ? (
        <div className="mx-4 bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
          Нет записей о покупках
        </div>
      ) : (
        <div className="mx-4 flex flex-col gap-3">
          {productPurchases.map((purchase) => {
            const store = storeMap.get(purchase.storeId)
            const dateStr = new Date(purchase.purchaseDate).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })

            if (editingId === purchase.id && purchasesCol) {
              return (
                <div key={purchase.id}>
                  <EditPurchase
                    purchase={purchase}
                    collection={purchasesCol}
                    onDone={() => setEditingId(null)}
                  />
                </div>
              )
            }

            return (
              <div
                key={purchase.id}
                className="bg-surface rounded-2xl px-4 py-3 active:bg-bg-secondary/50 transition-colors cursor-pointer"
                onClick={() => setEditingId(purchase.id)}
              >
                {/* Row 1: store + price + delete */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-[15px] font-medium text-text">
                      {store?.name ?? 'Неизвестный магазин'}
                    </span>
                    {store?.type && (
                      <span className="text-[12px] text-text-hint ml-1.5">
                        {store.type === 'market' ? 'Рынок' : 'Магазин'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[15px] font-semibold text-primary-text tabular-nums">
                      {purchase.priceByn.toFixed(2)} BYN
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmState({ type: 'purchase', purchase })
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                      title="Удалить покупку"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Row 2: date + rating */}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[12px] text-text-hint">{dateStr}</span>
                  {purchase.qualityRating ? (
                    <Rating value={purchase.qualityRating} readonly size="sm" />
                  ) : (
                    <span className="text-[12px] text-text-hint/60">нет оценки</span>
                  )}
                </div>

                {/* Row 3: comment */}
                {purchase.notes && (
                  <div className="mt-1.5 text-[13px] text-text-subtitle leading-snug">
                    {purchase.notes}
                  </div>
                )}

                {/* Edit hint */}
                <div className="mt-1.5 text-[11px] text-text-hint/40">
                  Нажмите для редактирования
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete product - only when no purchases */}
      {productPurchases.length === 0 && (
        <div className="mx-4 mt-6">
          <button
            onClick={() => setConfirmState({ type: 'product' })}
            className="w-full text-[13px] text-destructive/70 font-medium active:text-destructive transition-colors py-2"
          >
            Удалить продукт
          </button>
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.type === 'purchase' ? 'Удалить покупку?' : 'Удалить продукт?'}
          message={
            confirmState.type === 'purchase'
              ? 'Запись о покупке будет удалена.'
              : `Продукт «${product.name}» будет удалён. Это действие нельзя отменить.`
          }
          confirmLabel={confirmState.type === 'product' && deletingProduct ? 'Удаление...' : 'Удалить'}
          confirmDisabled={confirmState.type === 'product' && deletingProduct}
          destructive
          onConfirm={() =>
            confirmState.type === 'purchase'
              ? handleDeletePurchase(confirmState.purchase)
              : handleDeleteProduct()
          }
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  )
}
