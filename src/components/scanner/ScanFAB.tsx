interface ScanFABProps {
  onClick: () => void
}

export function ScanFAB({ onClick }: ScanFABProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Отсканировать штрих-код"
      className="fixed bottom-[152px] right-5 w-11 h-11 bg-surface/90 text-primary-text rounded-xl backdrop-blur-sm border border-white/20 flex items-center justify-center active:scale-95 transition-transform z-20 fab-shadow will-change-transform"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
      </svg>
    </button>
  )
}
