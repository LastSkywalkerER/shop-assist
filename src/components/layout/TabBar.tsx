import { createPortal } from 'react-dom'

interface TabBarProps {
  activeTab: 'products' | 'expenses' | 'shopping-list'
  onTabChange: (tab: 'products' | 'expenses' | 'shopping-list') => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-3 px-4 z-10 pointer-events-none">
      <div className="glass-tab rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-white/20 flex w-full max-w-sm pointer-events-auto">
        <button
          onClick={() => onTabChange('products')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-l-2xl transition-colors relative active:opacity-70 ${
            activeTab === 'products' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <span className="text-[10px] font-medium">Товары</span>
          {activeTab === 'products' && (
            <div className="absolute bottom-1.5 w-1 h-1 rounded-full bg-primary-text" />
          )}
        </button>

        <button
          onClick={() => onTabChange('expenses')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative active:opacity-70 ${
            activeTab === 'expenses' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
          <span className="text-[10px] font-medium">Расходы</span>
          {activeTab === 'expenses' && (
            <div className="absolute bottom-1.5 w-1 h-1 rounded-full bg-primary-text" />
          )}
        </button>

        <button
          onClick={() => onTabChange('shopping-list')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-r-2xl transition-colors relative active:opacity-70 ${
            activeTab === 'shopping-list' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          <span className="text-[10px] font-medium">Список</span>
          {activeTab === 'shopping-list' && (
            <div className="absolute bottom-1.5 w-1 h-1 rounded-full bg-primary-text" />
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}
