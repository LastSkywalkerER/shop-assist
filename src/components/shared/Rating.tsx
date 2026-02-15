interface RatingProps {
  value: number | undefined
  onChange?: (value: number) => void
  readonly?: boolean
  size?: 'xs' | 'sm' | 'md'
}

const SIZE_CLASSES = {
  xs: 'text-[10px]',
  sm: 'text-[14px]',
  md: 'text-[28px] p-0.5',
}

export function Rating({ value, onChange, readonly = false, size = 'md' }: RatingProps) {
  const stars = [1, 2, 3, 4, 5]

  return (
    <div className={`flex ${size === 'md' ? 'gap-1' : 'gap-px'}`}>
      {stars.map((star) => {
        const active = value != null && star <= value
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(value === star ? 0 : star)}
            className={`
              ${readonly ? 'cursor-default' : 'cursor-pointer active:scale-90'}
              transition-all select-none
              ${SIZE_CLASSES[size]}
              ${active ? 'text-amber-400 drop-shadow-[0_1px_2px_rgba(251,191,36,0.4)]' : 'text-separator opacity-60'}
            `}
          >
            ★
          </button>
        )
      })}
    </div>
  )
}
