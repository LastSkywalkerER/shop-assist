import { useState, useMemo, useRef, useEffect } from 'react'
import type { SplitGroupDocument } from '../../db/types'

interface SplitGroupSelectProps {
  groups: SplitGroupDocument[]
  selected: SplitGroupDocument | null
  onSelect: (group: SplitGroupDocument | null) => void
  onCreate: (name: string) => Promise<void>
}

/**
 * Select-or-create input for the expense's split group — the settlement scope
 * the who-owes-whom math is computed in. Mirrors ExpenseCategorySelect.
 */
export function SplitGroupSelect({ groups, selected, onSelect, onCreate }: SplitGroupSelectProps) {
  const [value, setValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!value.trim()) return groups
    const query = value.trim().toLowerCase()
    return groups.filter((g) => g.name.toLowerCase().includes(query))
  }, [groups, value])

  const hasExactMatch = useMemo(() => {
    if (!value.trim()) return true
    return groups.some((g) => g.name.toLowerCase() === value.trim().toLowerCase())
  }, [groups, value])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">Группа разделения</label>
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-[15px] text-text">{selected.name}</span>
          <button
            onClick={() => {
              onSelect(null)
              setValue('')
            }}
            className="text-[13px] text-primary-text font-medium active:opacity-60 transition-opacity"
          >
            Изменить
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1.5 relative">
      <label className="text-[13px] text-section-header font-medium pl-1">Группа разделения</label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Опционально — для расчёта «кто кому должен»"
        className="bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface rounded-xl shadow-lg border border-separator/30 py-1 z-50 max-h-44 overflow-y-auto">
          {/* Create new option */}
          {value.trim() && !hasExactMatch && (
            <button
              onClick={async () => {
                await onCreate(value.trim())
                setValue('')
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-[15px] text-primary-text hover:bg-bg-secondary/50 transition-colors"
            >
              «{value.trim()}» — создать
            </button>
          )}

          {/* Existing groups */}
          {filtered.map((group) => (
            <button
              key={group.id}
              onClick={() => {
                onSelect(group)
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-[15px] text-text hover:bg-bg-secondary/50 transition-colors"
            >
              {group.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
