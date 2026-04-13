import { Virtuoso } from 'react-virtuoso'
import { ProductRow, type ProductRowData } from './ProductRow'

interface ProductTableProps {
  data: ProductRowData[]
  loading?: boolean
  customScrollParent?: HTMLElement | null
}

function SkeletonCard() {
  return (
    <div className="glass rounded-2xl px-3.5 py-3 border border-separator/10 animate-pulse">
      <div className="h-4 bg-text/10 rounded-full w-2/3 mb-2" />
      <div className="h-3 bg-text/8 rounded-full w-1/3" />
    </div>
  )
}

export function ProductTable({ data, loading, customScrollParent }: ProductTableProps) {
  if (loading) {
    return (
      <div className="mx-4 mt-2 flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-8 pb-20">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-80">🛒</div>
          <div className="text-[17px] font-medium text-text mb-1">Пока пусто</div>
          <div className="text-[13px] text-text-hint leading-snug">
            Нажмите <span className="inline-flex items-center justify-center w-6 h-6 bg-primary text-on-primary rounded-full text-[14px] font-medium align-middle mx-0.5">+</span> чтобы<br />добавить первую запись цены
          </div>
        </div>
      </div>
    )
  }

  return (
    <Virtuoso
      customScrollParent={customScrollParent ?? undefined}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      totalCount={data.length}
      itemContent={(index) => (
        <div className={`mx-4 ${index === 0 ? 'mt-2' : 'mt-3'} ${index === data.length - 1 ? 'mb-2' : ''}`}>
          <ProductRow data={data[index]} />
        </div>
      )}
    />
  )
}
