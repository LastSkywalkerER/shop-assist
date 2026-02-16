import type { ExpenseCategoryDocument } from '../../db/types'

interface ExpenseCategoryFilterProps {
  categories: ExpenseCategoryDocument[]
  selected: string | null
  onSelect: (categoryId: string | null) => void
}

export function ExpenseCategoryFilter({ categories, selected, onSelect }: ExpenseCategoryFilterProps) {
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
            key={cat.id}
            onClick={() => onSelect(selected === cat.id ? null : cat.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${
              selected === cat.id
                ? 'bg-primary text-on-primary'
                : 'bg-surface text-text-hint active:bg-separator/30'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  )
}
