import { useState, useMemo, useRef, useEffect } from 'react'

interface CategorySelectProps {
  categories: string[]
  value: string
  onChange: (value: string) => void
  label?: string
  inputClassName?: string
}

export function CategorySelect({ categories, value, onChange, label = 'Категория', inputClassName }: CategorySelectProps) {
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
    if (!value.trim()) return categories
    const q = value.trim().toLowerCase()
    return categories.filter((c) => c.toLowerCase().includes(q))
  }, [categories, value])

  const hasExactMatch = useMemo(() => {
    if (!value.trim()) return true
    return categories.some((c) => c.toLowerCase() === value.trim().toLowerCase())
  }, [categories, value])

  return (
    <div className="flex flex-col gap-1.5 relative" ref={wrapperRef}>
      {label && (
        <label className="text-[13px] text-section-header font-medium pl-1">{label}</label>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Молочные"
        className={inputClassName ?? "w-full bg-bg-secondary rounded-xl px-3 py-2 text-[14px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"}
      />
      {isOpen && (filtered.length > 0 || (value.trim() && !hasExactMatch)) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-10 max-h-44 overflow-y-auto overflow-x-hidden">
          {/* Create new option */}
          {value.trim() && !hasExactMatch && (
            <button
              onClick={() => {
                onChange(value.trim())
                setIsOpen(false)
              }}
              className="w-full text-left px-3 py-2 active:bg-primary/5 transition-colors border-b border-separator/20 flex items-center gap-1.5"
            >
              <span className="text-primary-text font-medium text-[14px]">«{value.trim()}»</span>
              <span className="text-[12px] text-text-hint">— создать</span>
            </button>
          )}
          {filtered.map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c)
                setIsOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-[14px] text-text active:bg-bg-secondary transition-colors border-b border-separator/20 last:border-b-0"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
