interface CategoryFilterProps {
  categories: string[]
  selected: string | null
  onSelect: (category: string | null) => void
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="px-4 pb-1 overflow-x-auto scrollbar-none">
      <div className="flex gap-2">
        <button
          onClick={() => onSelect(null)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${
            selected === null
              ? 'bg-primary text-on-primary'
              : 'bg-surface text-text-hint active:bg-separator/30'
          }`}
        >
          Все
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onSelect(selected === cat ? null : cat)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${
              selected === cat
                ? 'bg-primary text-on-primary'
                : 'bg-surface text-text-hint active:bg-separator/30'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
    </div>
  )
}
