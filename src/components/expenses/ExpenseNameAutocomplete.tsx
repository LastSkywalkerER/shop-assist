import { useState, useMemo, useRef, useEffect } from 'react'

interface ExpenseNameAutocompleteProps {
  expenses: Array<{ name?: string }>
  value: string
  onChange: (value: string) => void
}

export function ExpenseNameAutocomplete({ expenses, value, onChange }: ExpenseNameAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Get unique expense names
  const existingNames = useMemo(() => {
    const names = new Set<string>()
    for (const e of expenses) {
      if (e.name) names.add(e.name)
    }
    return Array.from(names).sort()
  }, [expenses])

  // Filter names by current input
  const filtered = useMemo(() => {
    if (!value.trim()) return existingNames.slice(0, 10)
    const query = value.trim().toLowerCase()
    return existingNames.filter((n) => n.toLowerCase().includes(query)).slice(0, 10)
  }, [existingNames, value])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1.5 relative">
      <label className="text-[13px] text-section-header font-medium pl-1">Название</label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Опционально"
        className="bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />

      {/* Dropdown */}
      {isOpen && filtered.length > 0 && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 glass rounded-xl shadow-lg border border-separator/30 py-1 z-50 max-h-44 overflow-y-auto">
          {filtered.map((name) => (
            <button
              key={name}
              onClick={() => {
                onChange(name)
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-[15px] text-text hover:bg-bg-secondary/50 transition-colors"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
