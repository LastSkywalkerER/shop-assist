import { useState, useMemo, useRef, useEffect } from 'react'
import type { ProductDocument } from '../../db/types'
import { ProductForm } from './ProductForm'

interface ProductSelectProps {
  products: ProductDocument[]
  categories: string[]
  selected: ProductDocument | null
  onSelect: (product: ProductDocument) => void
  onCreate: (data: { name: string; category?: string }) => void
}

export function ProductSelect({ products, categories, selected, onSelect, onCreate }: ProductSelectProps) {
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return products
    const words = query.trim().toLowerCase().split(/\s+/)
    return products.filter((p) => {
      const searchable = [p.name, p.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return words.every((w) => searchable.includes(w))
    })
  }, [products, query])

  const hasExactMatch = useMemo(() => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return filtered.some((p) => p.name.toLowerCase() === q)
  }, [filtered, query])

  const handleQuickCreate = () => {
    if (!query.trim() || hasExactMatch) return
    onCreate({ name: query.trim() })
    setQuery('')
    setIsOpen(false)
  }

  if (showForm) {
    return (
      <ProductForm
        categories={categories}
        onSave={(data) => {
          onCreate(data)
          setShowForm(false)
          setQuery('')
        }}
        onCancel={() => setShowForm(false)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1.5" ref={wrapperRef}>
      <label className="text-[13px] text-section-header font-medium pl-1">Продукт</label>
      {selected ? (
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between ring-2 ring-primary/20">
          <div className="flex-1 min-w-0">
            <span className="text-[15px] font-medium text-text">{selected.name}</span>
            {selected.category && (
              <span className="text-[13px] text-text-hint ml-1.5">{selected.category}</span>
            )}
          </div>
          <button
            onClick={() => onSelect(null!)}
            className="text-[13px] text-primary-text font-medium ml-3 shrink-0"
          >
            Изменить
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Введите название..."
            className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
          />
          {isOpen && (filtered.length > 0 || query.trim()) && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-10 max-h-52 overflow-y-auto overflow-x-hidden">
              {/* Quick create — just the name, no extra fields */}
              {query.trim() && !hasExactMatch && (
                <button
                  onClick={handleQuickCreate}
                  className="w-full text-left px-4 py-2.5 active:bg-primary/5 transition-colors border-b border-separator/20 flex items-center gap-2"
                >
                  <span className="text-primary-text font-medium text-[15px]">«{query.trim()}»</span>
                  <span className="text-[12px] text-text-hint">— создать</span>
                </button>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelect(p)
                    setIsOpen(false)
                    setQuery('')
                  }}
                  className="w-full text-left px-4 py-2.5 active:bg-bg-secondary transition-colors border-b border-separator/20 last:border-b-0"
                >
                  <div className="text-[15px] text-text">{p.name}</div>
                  {p.category && (
                    <div className="text-[12px] text-text-hint mt-0.5">{p.category}</div>
                  )}
                </button>
              ))}
              {/* Detailed form create */}
              <button
                onClick={() => {
                  setShowForm(true)
                  setIsOpen(false)
                }}
                className="w-full text-left px-4 py-3 text-primary-text font-medium text-[15px] active:bg-primary/5 transition-colors border-t border-separator/30"
              >
                + Создать с подробностями
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
