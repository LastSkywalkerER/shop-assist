import { useNavigate } from 'react-router-dom'
import { Rating } from '../shared/Rating'

export interface StorePurchaseInfo {
  storeName: string
  bestPrice: number
  lastPrice: number
  currency: string
  avgRating: number | null
  count: number
}

export interface ProductRowData {
  productId: string
  productName: string
  manufacturer?: string
  packageVolume?: string
  variety?: string
  category?: string
  stores: StorePurchaseInfo[]
  purchaseCount: number
}

interface ProductRowProps {
  data: ProductRowData
}

export function ProductRow({ data }: ProductRowProps) {
  const navigate = useNavigate()
  const subtitle = [data.manufacturer, data.packageVolume, data.variety].filter(Boolean).join(' · ')

  return (
    <div
      className="glass rounded-2xl px-3.5 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-separator/10 active:opacity-80 transition-opacity cursor-pointer"
      onClick={() => navigate(`/product/${data.productId}`)}
    >
      {/* Top line: name + chevron */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-medium text-text leading-tight">{data.productName}</span>
          {subtitle && (
            <span className="text-[12px] text-text-hint ml-1.5">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-text-hint tabular-nums">{data.purchaseCount}x</span>
          <svg className="text-text-hint/40" width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l4 4-4 4" />
          </svg>
        </div>
      </div>

      {/* Store rows */}
      {data.stores.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {data.stores.map((s) => (
            <div key={s.storeName} className="flex items-center gap-2 min-h-[22px]">
              <span className="text-[12px] text-text-subtitle truncate min-w-0 flex-shrink">{s.storeName}</span>
              <span className="text-[13px] text-primary-text font-semibold tabular-nums whitespace-nowrap">
                {s.bestPrice.toFixed(2)} {s.currency}
              </span>
              {s.lastPrice !== s.bestPrice && (
                <span className="text-[11px] text-text-hint tabular-nums whitespace-nowrap">
                  / {s.lastPrice.toFixed(2)}
                </span>
              )}
              {s.avgRating !== null && (
                <Rating value={Math.round(s.avgRating)} readonly size="xs" />
              )}
            </div>
          ))}
        </div>
      )}

      {data.purchaseCount === 0 && (
        <div className="mt-1 text-[12px] text-text-hint">Нет покупок</div>
      )}
    </div>
  )
}
