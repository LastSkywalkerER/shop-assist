import { useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { GroupedVirtuoso } from 'react-virtuoso'
import { useDragSelect } from '../hooks/useDragSelect'
import { TabBar } from '../components/layout/TabBar'
import { useRxCollection, useRxQuery } from '../db/hooks'
import type { ShoppingListItemDocument } from '../db/types'
import { ConfirmModal } from '../components/shared/ConfirmModal'
import { isValidUrl, urlHostname } from '../components/purchase/UrlInput'
import { fetchPageMeta } from '../lib/fetchMeta'
import { parseLinkMeta, serializeLinkMeta, type LinkMeta } from '../lib/linkMeta'
import { useAuth } from '../contexts/AuthContext'

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function isOlderThanOneWeek(dateStr: string): boolean {
  const date = new Date(dateStr)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  return date < weekAgo
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

  const link = parseLinkMeta(item.link)
  const isUrlItem = !!link
  const displayText = link?.title || (isUrlItem ? urlHostname(link!.url) : item.name)

  return (
    <div
      data-item-id={item.id}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handlePressEnd}
      onTouchCancel={handlePressEnd}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
      className={`glass rounded-2xl px-3.5 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-separator/10 flex items-center gap-3 cursor-pointer active:opacity-80 transition-opacity ${selected ? 'ring-2 ring-primary' : ''}`}
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

      <div className="flex-1 min-w-0">
        {isUrlItem ? (
          <>
            <div className="flex items-center gap-1.5">
              {link!.favicon && (
                <img
                  src={link!.favicon}
                  alt=""
                  className="w-4 h-4 rounded-sm object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <a
                href={link!.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (selectionMode) { e.preventDefault(); onToggleSelect() }
                  else e.stopPropagation()
                }}
                className={`text-[15px] text-primary underline-offset-2 hover:underline leading-snug truncate ${item.done ? 'line-through opacity-50' : ''}`}
              >
                {displayText}
              </a>
            </div>
            <span className="text-[11px] text-text-hint/50 block truncate">{urlHostname(link!.url)}</span>
          </>
        ) : (
          <span className={`text-[15px] ${item.done ? 'line-through text-text-hint' : 'text-text'}`}>
            {item.name}
          </span>
        )}
        {item.creatorName && (
          <span className="text-[11px] text-text-hint block truncate mt-0.5">
            {item.creatorName}
          </span>
        )}
      </div>

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
  const { user } = useAuth()
  const col = useRxCollection<ShoppingListItemDocument>('shoppingListItems')
  const { data: allItems, loading } = useRxQuery(col)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingUrl, setAddingUrl] = useState(false)
  const [urlPreview, setUrlPreview] = useState<LinkMeta | null>(null)
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const creatorName = user?.first_name ?? ''
  const [hideOldDone, setHideOldDone] = useState(() => {
    const stored = localStorage.getItem('shopping-list-hide-old-done')
    return stored === null ? true : stored === 'true'
  })

  const sortedItems = [...allItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const filteredItems = hideOldDone
    ? sortedItems.filter((item) => !(item.done && isOlderThanOneWeek(item.createdAt)))
    : sortedItems
  const groups = useMemo(() => groupByDate(filteredItems), [filteredItems])
  const groupCounts = useMemo(() => groups.map((g) => g.items.length), [groups])
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const handleHideOldDoneChange = (checked: boolean) => {
    setHideOldDone(checked)
    localStorage.setItem('shopping-list-hide-old-done', String(checked))
  }

  const insertItem = async (name: string, linkMeta?: LinkMeta) => {
    if (!name.trim() || !col) return
    const now = new Date().toISOString()
    await col.insert({
      id: crypto.randomUUID(),
      name: name.trim(),
      done: false,
      link: linkMeta ? serializeLinkMeta(linkMeta) : undefined,
      creatorName: creatorName.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })
    setInputValue('')
    setUrlPreview(null)
    inputRef.current?.focus()
  }

  const handleAddFromInput = async () => {
    if (urlPreview) {
      await insertItem(urlPreview.title || urlHostname(urlPreview.url), urlPreview)
      return
    }

    const trimmed = inputValue.trim()
    if (!trimmed || addingUrl) return

    if (isValidUrl(trimmed)) {
      setAddingUrl(true)
      try {
        const meta = await fetchPageMeta(trimmed)
        const linkMeta: LinkMeta = { url: trimmed, title: meta.title, description: meta.description, image: meta.image, favicon: meta.favicon }
        await insertItem(meta.title || urlHostname(trimmed), linkMeta)
      } catch {
        await insertItem(urlHostname(trimmed), { url: trimmed })
      } finally {
        setAddingUrl(false)
      }
    } else {
      await insertItem(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddFromInput()
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim()
    if (!isValidUrl(pasted)) return
    e.preventDefault()
    setInputValue(pasted)
    setAddingUrl(true)
    fetchPageMeta(pasted)
      .then((meta) => {
        setUrlPreview({ url: pasted, title: meta.title, description: meta.description, image: meta.image, favicon: meta.favicon })
      })
      .catch(() => {
        setUrlPreview({ url: pasted })
      })
      .finally(() => setAddingUrl(false))
  }

  const handleClearUrlPreview = () => {
    setUrlPreview(null)
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleToggle = async (item: ShoppingListItemDocument) => {
    const doc = await col?.findOne(item.id).exec()
    if (doc) await doc.patch({ done: !item.done, updatedAt: new Date().toISOString() })
  }

  const handleLongPress = (id: string) => {
    setSelectionMode(true)
    setSelectedIds(new Set([id]))
  }

  const addToSelection = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]))
  }, [])

  useDragSelect(selectionMode, addToSelection, 'data-item-id')

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

  const handleCreateExpenseFromSelected = () => {
    const selectedItems = allItems.filter((item) => selectedIds.has(item.id))
    navigate('/expenses/add', { state: { prefilledItems: selectedItems } })
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const handleTabChange = (tab: 'products' | 'expenses' | 'shopping-list') => {
    if (tab === 'products') navigate('/products')
    else if (tab === 'expenses') navigate('/')
  }

  return (
    <>
      <div ref={setScrollParent} className="flex flex-col flex-1 pb-[136px] overflow-y-auto">
        {/* List */}
        {loading ? (
          <div className="mx-4 mt-3 flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="glass rounded-2xl px-3.5 py-2.5 border border-separator/10 animate-pulse">
                <div className="h-4 bg-text/10 rounded-full w-1/2" />
              </div>
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-8">
            <div className="text-center">
              <div className="text-5xl mb-4 opacity-80">🛒</div>
              <div className="text-[17px] font-medium text-text mb-1">Список пуст</div>
              <div className="text-[13px] text-text-hint">Добавьте товар или вставьте ссылку снизу</div>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex-1">
            {/* Hide old done toggle above list */}
            <div className="flex items-center justify-end px-5 pb-1">
              <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={hideOldDone}
                  onChange={(e) => handleHideOldDoneChange(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-separator text-primary focus:ring-primary/30"
                />
                <span className="text-[11px] text-text-hint">Скрыть старые выполненные</span>
              </label>
            </div>
            <GroupedVirtuoso
              customScrollParent={scrollParent ?? undefined}
              groupCounts={groupCounts}
              groupContent={(index) => (
                <div className="text-[12px] text-text-hint font-medium px-5 pt-2 pb-1 bg-bg/80 backdrop-blur-sm">
                  {groups[index].label}
                </div>
              )}
              itemContent={(index) => {
                const item = flatItems[index]
                return (
                  <div className="mx-4 mb-2">
                    <ItemRow
                      key={item.id}
                      item={item}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(item.id)}
                      onToggle={() => handleToggle(item)}
                      onToggleSelect={() => handleToggleSelect(item.id)}
                      onLongPress={() => handleLongPress(item.id)}
                    />
                  </div>
                )
              }}
            />
          </div>
        )}
      </div>

      {/* Selection mode controls */}
      {selectionMode && (
        <>
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={handleCreateExpenseFromSelected}
                className="fixed bottom-[88px] right-[77px] w-[52px] h-[52px] bg-primary text-on-primary rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
                title="Создать расход"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="fixed bottom-[88px] right-5 w-[52px] h-[52px] bg-destructive text-on-primary rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </>
          )}
          <button
            onClick={handleCancelSelection}
            className="fixed bottom-[88px] left-5 px-4 py-2.5 glass rounded-2xl border border-white/20 shadow-lg text-[15px] font-medium text-text active:opacity-80 transition-opacity z-20"
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

      {/* Fixed glass input bar above the tab pill */}
      {createPortal(<div className="fixed bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div className="px-4 pb-[80px] pt-2 pointer-events-auto">
          <div className="glass rounded-2xl border border-separator/20 ring-1 ring-link/15 shadow-[0_4px_20px_rgba(0,0,0,0.1)] flex items-center gap-2 px-3 py-2.5 min-h-[52px]">

            {urlPreview ? (
              <>
                <button
                  type="button"
                  onClick={handleClearUrlPreview}
                  className="text-text-hint/50 active:opacity-60 shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
                {urlPreview.favicon && (
                  <img
                    src={urlPreview.favicon}
                    alt=""
                    className="w-5 h-5 rounded-sm object-contain shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] text-primary font-medium truncate leading-tight">
                    {urlPreview.title || urlHostname(urlPreview.url)}
                  </p>
                  <p className="text-[11px] text-text-hint/60 truncate">{urlHostname(urlPreview.url)}</p>
                </div>
                <button
                  onPointerDown={(e) => { e.preventDefault(); void handleAddFromInput() }}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-on-primary active:opacity-70 transition-opacity shrink-0"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Товар или ссылка..."
                  disabled={addingUrl}
                  className="flex-1 bg-transparent text-[15px] text-text placeholder:text-text-hint outline-none disabled:opacity-60"
                />
                {addingUrl ? (
                  <div className="w-8 h-8 flex items-center justify-center shrink-0">
                    <svg className="animate-spin w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  </div>
                ) : (
                  <button
                    onPointerDown={(e) => { if (!inputValue.trim()) return; e.preventDefault(); void handleAddFromInput() }}
                    disabled={!inputValue.trim()}
                    className="w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-on-primary active:opacity-70 transition-opacity disabled:opacity-40 shrink-0"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>, document.body)}

      <TabBar activeTab="shopping-list" onTabChange={handleTabChange} />
    </>
  )
}
