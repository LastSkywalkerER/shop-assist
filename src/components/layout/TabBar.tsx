interface TabBarProps {
  activeTab: 'products' | 'expenses' | 'shopping-list'
  onTabChange: (tab: 'products' | 'expenses' | 'shopping-list') => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-separator/30 z-10">
      <div className="flex">
        <button
          onClick={() => onTabChange('products')}
          className={`flex-1 py-2.5 text-[15px] font-medium transition-colors relative ${
            activeTab === 'products' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          Продукты
          {activeTab === 'products' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => onTabChange('expenses')}
          className={`flex-1 py-2.5 text-[15px] font-medium transition-colors relative ${
            activeTab === 'expenses' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          Расходы
          {activeTab === 'expenses' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => onTabChange('shopping-list')}
          className={`flex-1 py-2.5 text-[15px] font-medium transition-colors relative ${
            activeTab === 'shopping-list' ? 'text-primary-text' : 'text-text-hint'
          }`}
        >
          Список
          {activeTab === 'shopping-list' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>
    </div>
  )
}
