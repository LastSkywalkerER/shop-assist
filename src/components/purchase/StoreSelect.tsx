import { useState, useMemo, useRef, useEffect } from 'react'
import type { StoreDocument } from '../../db/types'
import { StoreForm } from './StoreForm'
import { useOsmSearch, type OsmResult } from '../../hooks/useOsmSearch'
import { useCity } from '../../config/CityContext'

interface StoreSelectProps {
  stores: StoreDocument[]
  selected: StoreDocument | null
  onSelect: (store: StoreDocument) => void
  onCreate: (data: { name: string; address?: string }) => Promise<StoreDocument | undefined>
}

export function StoreSelect({ stores, selected, onSelect, onCreate }: StoreSelectProps) {
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { city } = useCity()
  const { results: osmResults, loading: osmLoading } = useOsmSearch(query, city)

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
    if (!query.trim()) return stores
    const words = query.trim().toLowerCase().split(/\s+/)
    return stores.filter((s) => {
      const searchable = `${s.name.toLowerCase()} ${(s.address ?? '').toLowerCase()}`
      return words.every((w) => searchable.includes(w))
    })
  }, [stores, query])

  const hasExactMatch = useMemo(() => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return filtered.some((s) => s.name.toLowerCase() === q)
  }, [filtered, query])

  const handleQuickCreate = async () => {
    if (!query.trim() || hasExactMatch) return
    const store = await onCreate({ name: query.trim() })
    if (store) onSelect(store)
    setQuery('')
    setIsOpen(false)
  }

  const handleOsmSelect = async (osm: OsmResult) => {
    const store = await onCreate({
      name: osm.name,
      address: osm.address,
    })
    if (store) onSelect(store)
    setQuery('')
    setIsOpen(false)
  }

  if (showForm) {
    return (
      <StoreForm
        onSave={async (data) => {
          const store = await onCreate(data)
          if (store) onSelect(store)
          setShowForm(false)
          setQuery('')
        }}
        onCancel={() => setShowForm(false)}
      />
    )
  }

  const hasDropdownContent = filtered.length > 0 || query.trim() || osmResults.length > 0 || osmLoading

  return (
    <div className="flex flex-col gap-1.5" ref={wrapperRef}>
      <label className="text-[13px] text-section-header font-medium pl-1">Место</label>
      {selected ? (
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between ring-2 ring-primary/20">
          <div className="flex-1 min-w-0">
            <span className="text-[15px] font-medium text-text">{selected.name}</span>
            {selected.address && (
              <span className="text-[13px] text-text-hint ml-1.5">{selected.address}</span>
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
          {isOpen && hasDropdownContent && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-10 max-h-72 overflow-y-auto overflow-x-hidden">
              {/* Quick create */}
              {query.trim() && !hasExactMatch && (
                <button
                  onClick={handleQuickCreate}
                  className="w-full text-left px-4 py-2.5 active:bg-primary/5 transition-colors border-b border-separator/20 flex items-center gap-2"
                >
                  <span className="text-primary-text font-medium text-[15px]">«{query.trim()}»</span>
                  <span className="text-[12px] text-text-hint">— создать</span>
                </button>
              )}

              {/* Existing stores */}
              {filtered.length > 0 && (
                <>
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onSelect(s)
                        setIsOpen(false)
                        setQuery('')
                      }}
                      className="w-full text-left px-4 py-2.5 active:bg-bg-secondary transition-colors border-b border-separator/20"
                    >
                      <div className="text-[15px] text-text">{s.name}</div>
                      {s.address && (
                        <div className="text-[12px] text-text-hint mt-0.5">{s.address}</div>
                      )}
                    </button>
                  ))}
                </>
              )}

              {/* Map search results */}
              {query.trim().length >= 2 && (
                <>
                  {(osmResults.length > 0 || osmLoading) && (
                    <div className="px-4 pt-2.5 pb-1 flex items-center gap-2 border-t border-separator/30">
                      <span className="text-[11px] text-text-hint font-medium uppercase tracking-wide">На карте</span>
                      {osmLoading && (
                        <div className="w-3 h-3 border-[1.5px] border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                  )}
                  {osmResults.map((osm) => (
                    <button
                      key={osm.osmId}
                      onClick={() => handleOsmSelect(osm)}
                      className="w-full text-left px-4 py-2.5 active:bg-bg-secondary transition-colors border-b border-separator/20"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg className="text-text-hint shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span className="text-[15px] text-text">{osm.name}</span>
                        <span className="text-[10px] text-text-hint/40 ml-auto shrink-0">{osm.source}</span>
                      </div>
                      {osm.address && (
                        <div className="text-[12px] text-text-hint mt-0.5 pl-5">{osm.address}</div>
                      )}
                    </button>
                  ))}
                  {!osmLoading && osmResults.length === 0 && (
                    <div className="px-4 py-2 text-[12px] text-text-hint border-t border-separator/30">
                      Ничего не найдено на карте
                    </div>
                  )}
                </>
              )}

              {/* Detailed form */}
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
