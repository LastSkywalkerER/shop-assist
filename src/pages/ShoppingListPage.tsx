import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { TabBar } from '../components/layout/TabBar'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { ShoppingListItemDocument } from '../db/types'
import { ConfirmModal } from '../components/shared/ConfirmModal'

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function groupByDate(items: ShoppingListItemDocument[]): { label: string; key: string; items: ShoppingListItemDocument[] }[] {
  const map = new Map<string, ShoppingListItemDocument[]>()
  for (const item of items) {
    const key = item.createdAt.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({ key, label: formatDateLabel(key), items }))
}

interface ItemRowProps {
  item: ShoppingListItemDocument
  selectionMode: boolean
  selected: boolean
  onToggle: () => void
  onToggleSelect: () => void
  onLongPress: () => void
}

function ItemRow({ item, selectionMode, selected, onToggle, onToggleSelect, onLongPress }: ItemRowProps) {
  const pressTimer = useRef<NodeJS.Timeout | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)

  const handlePressStart = () => {
    if (!selectionMode) {
      pressTimer.current = setTimeout(() => onLongPress(), 500)
    }
  }

  const handlePressEnd = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    handlePressStart()
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!pressTimer.current || !touchStartPos.current) return
    const dx = e.touches[0].clientX - touchStartPos.current.x
    const dy = e.touches[0].clientY - touchStartPos.current.y
    if (Math.sqrt(dx * dx + dy * dy) > 8) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  const handleClick = () => {
    if (selectionMode) onToggleSelect()
    else onToggle()
  }

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handlePressEnd}
      onTouchCancel={handlePressEnd}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
      className={`bg-surface rounded-2xl px-3.5 py-2.5 flex items-center gap-3 cursor-pointer active:bg-bg-secondary/50 transition-colors ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      {selectionMode && (
        <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${selected ? 'bg-primary border-primary' : 'border-separator'}`}>
          {selected && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}
      <span className={`text-[15px] flex-1 ${item.done ? 'line-through text-text-hint' : 'text-text'}`}>
        {item.name}
      </span>
      {!selectionMode && (
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${item.done ? 'bg-primary border-primary' : 'border-separator'}`}>
          {item.done && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}
    </div>
  )
}

export function ShoppingListPage() {
  const navigate = useNavigate()
  const col = useRxCollection<ShoppingListItemDocument>('shoppingListItems')
  const allItems = useRxQuery(col)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const sortedItems = [...allItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const groups = groupByDate(sortedItems)

  const handleAdd = async () => {
    const name = inputValue.trim()
    if (!name || !col) return
    const now = new Date().toISOString()
    await col.insert({ id: crypto.randomUUID(), name, done: false, createdAt: now, updatedAt: now })
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
  }

  const handleToggle = async (item: ShoppingListItemDocument) => {
    const doc = await col?.findOne(item.id).exec()
    if (doc) await doc.patch({ done: !item.done, updatedAt: new Date().toISOString() })
  }

  const handleLongPress = (id: string) => {
    setSelectionMode(true)
    setSelectedIds(new Set([id]))
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCancelSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const handleDeleteSelected = async () => {
    if (!col || selectedIds.size === 0) return
    setDeleting(true)
    try {
      for (const id of selectedIds) {
        const doc = await col.findOne(id).exec()
        if (doc) await doc.remove()
      }
      setSelectedIds(new Set())
      setSelectionMode(false)
    } catch (err) {
      console.error('Failed to delete items:', err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleTabChange = (tab: 'products' | 'expenses' | 'shopping-list') => {
    if (tab === 'products') navigate('/')
    else if (tab === 'expenses') navigate('/expenses')
  }

  return (
    <>
      <div className="flex flex-col flex-1 pb-20 overflow-y-auto">
        {/* Add item bar */}
        <div className="px-4 pt-3 pb-2 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Добавить товар..."
            className="flex-1 bg-surface rounded-xl px-3.5 py-2.5 text-[15px] text-text placeholder:text-text-hint outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={handleAdd}
            disabled={!inputValue.trim()}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary text-on-primary active:opacity-70 transition-opacity disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {/* List */}
        {allItems.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-8">
            <div className="text-center">
              <div className="text-5xl mb-4 opacity-80">🛒</div>
              <div className="text-[17px] font-medium text-text mb-1">Список пуст</div>
              <div className="text-[13px] text-text-hint">Добавьте первый товар выше</div>
            </div>
          </div>
        ) : (
          <div className="mx-4 mt-1 flex flex-col gap-0">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="text-[12px] text-text-hint font-medium px-1 pt-3 pb-1">{group.label}</div>
                <div className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(item.id)}
                      onToggle={() => handleToggle(item)}
                      onToggleSelect={() => handleToggleSelect(item.id)}
                      onLongPress={() => handleLongPress(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selection mode controls */}
      {selectionMode && (
        <>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="fixed bottom-20 right-5 w-[52px] h-[52px] bg-destructive text-on-primary rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleCancelSelection}
            className="fixed bottom-20 left-5 px-4 py-2.5 bg-surface text-text rounded-2xl shadow-lg text-[15px] font-medium active:opacity-80 transition-opacity z-20"
          >
            Отмена
          </button>
        </>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Удалить ${selectedIds.size} ${selectedIds.size === 1 ? 'позицию' : 'позиции'}?`}
          message="Позиции будут удалены без возможности восстановления."
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          destructive
          confirmDisabled={deleting}
          onConfirm={handleDeleteSelected}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      <TabBar activeTab="shopping-list" onTabChange={handleTabChange} />
    </>
  )
}
