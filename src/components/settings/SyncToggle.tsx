interface SyncToggleProps {
  enabled: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void
}

export function SyncToggle({ enabled, disabled, onChange }: SyncToggleProps) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-[15px] text-text">Включить синхронизацию</span>
      <div className="relative">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className={`
          w-11 h-6 rounded-full transition-colors
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
          bg-separator/40
          peer-checked:bg-primary
          peer-disabled:opacity-50
        `} />
        <div className={`
          absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
          ${enabled ? 'translate-x-5' : 'translate-x-0'}
        `} />
      </div>
    </label>
  )
}
