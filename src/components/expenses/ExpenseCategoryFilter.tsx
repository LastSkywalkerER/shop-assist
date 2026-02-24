import type { ExpenseCategoryDocument } from '../../db/types'

interface ExpenseCategoryFilterProps {
  categories: ExpenseCategoryDocument[]
  selected: string | null
  onSelect: (categoryId: string | null) => void
}

export function ExpenseCategoryFilter({ categories, selected, onSelect }: ExpenseCategoryFilterProps) {
  return (
    <div className="px-4 pb-2.5 overflow-x-auto scrollbar-none">
      <div className="flex gap-2">
        <button
          onClick={() => onSelect(null)}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium outline-none transition-colors ${
            selected === null
              ? 'bg-primary text-on-primary'
              : 'glass-chip text-text-hint border border-separator/20 active:opacity-70'
          }`}
        >
          Все
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(selected === cat.id ? null : cat.id)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium outline-none transition-colors ${
              selected === cat.id
                ? 'bg-primary text-on-primary'
                : 'glass-chip text-text-hint border border-separator/20 active:opacity-70'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  )
}
