interface UpdatePromptProps {
  needRefresh: boolean
  offlineReady: boolean
  onUpdate: () => void
  onDismiss: () => void
}

export function UpdatePrompt({ needRefresh, offlineReady, onUpdate, onDismiss }: UpdatePromptProps) {
  if (!needRefresh && !offlineReady) return null

  return (
    <div className="bg-primary/95 text-on-primary px-4 py-2.5 flex items-center justify-between text-[13px] backdrop-blur-sm">
      {needRefresh ? (
        <>
          <span className="font-medium">Доступна новая версия</span>
          <div className="flex items-center gap-3">
            <button
              onClick={onUpdate}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full font-semibold text-[12px] transition-colors"
            >
              Обновить
            </button>
            <button onClick={onDismiss} className="opacity-60 hover:opacity-100 text-base leading-none transition-opacity">
              ✕
            </button>
          </div>
        </>
      ) : (
        <>
          <span>Приложение готово к работе офлайн</span>
          <button onClick={onDismiss} className="opacity-60 hover:opacity-100 text-base leading-none transition-opacity">
            ✕
          </button>
        </>
      )}
    </div>
  )
}
