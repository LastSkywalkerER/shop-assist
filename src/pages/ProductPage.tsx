import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { ProductDocument, StoreDocument, PurchaseDocument } from '../db/types'
import { Rating } from '../components/shared/Rating'
import { ConfirmModal } from '../components/shared/ConfirmModal'
import { EditPurchase } from '../components/purchase/EditPurchase'
import { EditProduct } from '../components/purchase/EditProduct'
import { showBackButton } from '../telegram/backButton'
import { parseLinkMeta } from '../lib/linkMeta'

export function ProductPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingProduct, setEditingProduct] = useState(false)
  const [confirmState, setConfirmState] = useState<null | { type: 'purchase'; purchase: PurchaseDocument } | { type: 'product' }>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  const productsCol = useRxCollection<ProductDocument>('products')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const { data: products } = useRxQuery(productsCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: purchases } = useRxQuery(purchasesCol)

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
      navigate(-1)
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
      <div className="p-4 text-text-hint text-[15px]">Товар не найден</div>
    )
  }

  const subtitle = [product.category].filter(Boolean).join(' · ')

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
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
              onClick={(e) => { e.stopPropagation(); navigate(-1) }}
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
          Записи цен ({productPurchases.length})
        </span>
      </div>

      {/* Purchases list */}
      {productPurchases.length === 0 ? (
        <div className="mx-4 bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
          Нет записей о ценах
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
                      {purchase.price.toFixed(2)} {purchase.currency}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmState({ type: 'purchase', purchase })
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                      title="Удалить запись цены"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Row 2: manufacturer / volume / variety */}
                {(purchase.manufacturer || purchase.packageVolume || purchase.variety) && (
                  <div className="mt-1 text-[12px] text-text-hint">
                    {[purchase.manufacturer, purchase.packageVolume, purchase.variety].filter(Boolean).join(' · ')}
                  </div>
                )}

                {/* Row 3: date + rating */}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[12px] text-text-hint">{dateStr}</span>
                  {purchase.qualityRating ? (
                    <Rating value={purchase.qualityRating} readonly size="sm" />
                  ) : (
                    <span className="text-[12px] text-text-hint/60">нет оценки</span>
                  )}
                </div>

                {/* Row 4: comment */}
                {purchase.notes && (
                  <div className="mt-1.5 text-[13px] text-text-subtitle leading-snug">
                    {purchase.notes}
                  </div>
                )}

                {/* Row 5: source link */}
                {(() => {
                  const link = parseLinkMeta(purchase.link)
                  if (!link) return null
                  const displayText = link.title || (() => { try { return new URL(link.url).hostname.replace(/^www\./, '') } catch { return link.url } })()
                  return (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 flex items-center gap-1.5 text-[12px] text-primary leading-snug hover:underline active:opacity-70"
                    >
                      {link.favicon ? (
                        <img
                          src={link.favicon}
                          alt=""
                          className="w-3.5 h-3.5 rounded-sm object-contain shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                      )}
                      <span className="truncate">{displayText}</span>
                    </a>
                  )
                })()}

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
            Удалить товар
          </button>
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.type === 'purchase' ? 'Удалить запись цены?' : 'Удалить товар?'}
          message={
            confirmState.type === 'purchase'
              ? 'Запись цены будет удалена.'
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
