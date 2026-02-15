interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-hint pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Поиск продуктов..."
          className="w-full bg-surface rounded-xl pl-9 pr-4 py-2 text-[15px] text-text placeholder:text-text-hint focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-text-hint/30 flex items-center justify-center text-[10px] text-on-primary font-bold"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
