interface FABProps {
  onClick: () => void
}

export function FAB({ onClick }: FABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-5 w-[52px] h-[52px] bg-primary text-on-primary rounded-2xl shadow-[0_4px_16px_rgba(0,122,255,0.35)] flex items-center justify-center active:scale-95 transition-transform z-20"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}
