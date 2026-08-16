import { useState, useMemo, useRef, useEffect } from 'react'

interface ExpenseGroupSelectProps {
  /** Known group names (existing groups plus local drafts). */
  groups: string[]
  selected: string | null
  onSelect: (group: string | null) => void
  /** Called for a name that does not exist yet — it is kept as a local draft. */
  onCreate: (name: string) => void
}

/**
 * Select-or-create input for the expense's group — the analytics bucket that
 * is independent from categories. Mirrors SplitGroupSelect, but groups are
 * plain names (see `ExpenseDocument.groupName`), not documents.
 */
export function ExpenseGroupSelect({ groups, selected, onSelect, onCreate }: ExpenseGroupSelectProps) {
  const [value, setValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!value.trim()) return groups
    const query = value.trim().toLowerCase()
    return groups.filter((g) => g.toLowerCase().includes(query))
  }, [groups, value])

  const hasExactMatch = useMemo(() => {
    if (!value.trim()) return true
    return groups.some((g) => g.toLowerCase() === value.trim().toLowerCase())
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
        <label className="text-[13px] text-section-header font-medium pl-1">Группа расходов</label>
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-[15px] text-text">{selected}</span>
          <button
            type="button"
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
      <label className="text-[13px] text-section-header font-medium pl-1">Группа расходов</label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Опционально — например «Поездка в Гродно»"
        className="bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface rounded-xl shadow-lg border border-separator/30 py-1 z-50 max-h-44 overflow-y-auto">
          {/* Create new option */}
          {value.trim() && !hasExactMatch && (
            <button
              type="button"
              onClick={() => {
                const name = value.trim()
                onCreate(name)
                onSelect(name)
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
              key={group}
              type="button"
              onClick={() => {
                onSelect(group)
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-[15px] text-text hover:bg-bg-secondary/50 transition-colors"
            >
              {group}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
