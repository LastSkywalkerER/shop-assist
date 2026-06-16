import { useState, useMemo, useRef } from 'react'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ExpenseDocument, StoreDocument, ExpenseCategoryDocument } from '../../db/types'
import { useAiSettings } from '../../contexts/AiSettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { DEFAULT_CURRENCY, getCurrencySymbol } from '../../config/currencies'
import { DEFAULT_MODELS } from '../../lib/ai/models'
import {
  parseExpenseList,
  ParseExpenseListError,
  type ParsedExpenseRow,
  type ParseExpenseListInput,
  type ParseExpenseListResult,
} from '../../lib/ai/parseExpenseList'
import { matchParsedRows } from '../../lib/ai/expenseListMatching'
import {
  BulkRowDetailEditor,
  type SharedOverride,
  type RowOverride,
} from './BulkRowDetailEditor'

interface BulkExpenseUploadFlowProps {
  onClose: () => void
}

interface RowItem {
  id: string
  row: ParsedExpenseRow
}

type Mode = 'image' | 'text' | 'pdf'
type Step = 'input' | 'reconcile' | 'review'

const TODAY = () => new Date().toISOString().split('T')[0]

export function BulkExpenseUploadFlow({ onClose }: BulkExpenseUploadFlowProps) {
  const { settings } = useAiSettings()
  const { roomId } = useAuth()
  const { showToast } = useToast()

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')

  const { data: expensesAll } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)

  const [step, setStep] = useState<Step>('input')
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [result, setResult] = useState<ParseExpenseListResult | null>(null)
  const [items, setItems] = useState<RowItem[]>([])
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [sharedByRawName, setSharedByRawName] = useState<Record<string, SharedOverride>>({})
  const [perRowById, setPerRowById] = useState<Record<string, RowOverride>>({})
  const [editingId, setEditingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const txtInputRef = useRef<HTMLInputElement>(null)

  const listCurrency = result?.currency || DEFAULT_CURRENCY

  const categoryByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.name.toLowerCase(), c.id)
    return m
  }, [categories])

  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores])

  const matches = useMemo(
    () => (result ? matchParsedRows(items.map((i) => i.row), listCurrency, expensesAll) : []),
    [items, listCurrency, expensesAll, result],
  )

  const rawNameCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.row.name, (m.get(it.row.name) ?? 0) + 1)
    return m
  }, [items])

  function effective(item: RowItem) {
    const shared = sharedByRawName[item.row.name] ?? {}
    const per = perRowById[item.id] ?? {}
    const cn = shared.customName?.trim()
    const name = cn || item.row.matchedLabel || item.row.name
    const amount = per.amount ?? String(item.row.amount)
    const currency = per.currency ?? item.row.currency ?? listCurrency
    const date = per.date ?? item.row.date ?? TODAY()
    const categoryId = shared.categoryId
      ?? (item.row.categoryName ? categoryByName.get(item.row.categoryName.toLowerCase()) : undefined)
    return {
      name,
      amount,
      currency,
      date,
      categoryId,
      storeId: shared.storeId,
      notes: shared.notes,
      creatorName: shared.creatorName,
    }
  }

  const fmtAmount = (a: number, cur: string) => `${a.toFixed(2)} ${getCurrencySymbol(cur)}`
  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

  const handleCreateStore = async (data: { name: string; address?: string }): Promise<StoreDocument | undefined> => {
    if (!storesCol) return undefined
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) =>
      s.name.toLowerCase() === nameLower && (data.address ? s.address?.toLowerCase() === data.address.toLowerCase() : !s.address))
    if (existing) return existing
    const now = new Date().toISOString()
    const store: StoreDocument = { id: crypto.randomUUID(), name: data.name, address: data.address, createdAt: now, updatedAt: now }
    await storesCol.insert(store)
    return store
  }

  const handleCreateCategory = async (categoryName: string): Promise<ExpenseCategoryDocument | undefined> => {
    if (!categoriesCol) return undefined
    const existing = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
    if (existing) return existing
    const now = new Date().toISOString()
    const cat: ExpenseCategoryDocument = { id: crypto.randomUUID(), name: categoryName, createdAt: now, updatedAt: now }
    await categoriesCol.insert(cat)
    return cat
  }

  const handleParse = async () => {
    setError('')
    let input: ParseExpenseListInput
    if (mode === 'text') {
      if (!text.trim()) { setError('Вставьте список расходов'); return }
      input = { kind: 'text', text }
    } else if (mode === 'image') {
      if (!file) { setError('Выберите изображение'); return }
      input = { kind: 'image', blob: file }
    } else {
      if (!file) { setError('Выберите PDF-файл'); return }
      input = { kind: 'pdf', blob: file, filename: file.name }
    }

    setParsing(true)
    try {
      const model = settings?.modelExtract || DEFAULT_MODELS.extract
      const labels = Array.from(
        new Set(expensesAll.map((e) => e.name).filter((n): n is string => !!n && !!n.trim())),
      ).slice(0, 500)
      const categoryNames = categories.map((c) => c.name)
      const res = await parseExpenseList({ input, model, currency: DEFAULT_CURRENCY, labels, categoryNames })
      if (res.rows.length === 0) { setError('Не удалось распознать ни одной строки'); return }
      const newItems: RowItem[] = res.rows.map((row) => ({ id: crypto.randomUUID(), row }))
      const newMatches = matchParsedRows(res.rows, res.currency || DEFAULT_CURRENCY, expensesAll)
      setResult(res)
      setItems(newItems)
      setSharedByRawName({})
      setPerRowById({})
      setSelectedRowIds(new Set(newItems.filter((_, i) => !newMatches[i].match).map((it) => it.id)))
      setStep('reconcile')
    } catch (err) {
      console.error('Failed to parse expense list:', err)
      setError(err instanceof ParseExpenseListError ? err.message : 'Ошибка распознавания')
    } finally {
      setParsing(false)
    }
  }

  const toggleRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setQuickName = (rawName: string, value: string) => {
    setSharedByRawName((prev) => ({ ...prev, [rawName]: { ...prev[rawName], customName: value } }))
  }

  const handleDetailSave = (item: RowItem, shared: SharedOverride, row: RowOverride) => {
    setSharedByRawName((prev) => ({ ...prev, [item.row.name]: { ...prev[item.row.name], ...shared } }))
    setPerRowById((prev) => ({ ...prev, [item.id]: { ...prev[item.id], ...row } }))
    setEditingId(null)
  }

  const selectedItems = useMemo(
    () => items.filter((it) => selectedRowIds.has(it.id)),
    [items, selectedRowIds],
  )

  const handleAdd = async () => {
    if (!expensesCol || selectedItems.length === 0) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const docs = selectedItems.map((item) => {
        const e = effective(item)
        return {
          id: crypto.randomUUID(),
          name: e.name.trim() || undefined,
          storeId: e.storeId,
          amount: parseFloat(parseFloat(e.amount).toFixed(2)),
          currency: e.currency,
          date: new Date(e.date).toISOString(),
          categoryId: e.categoryId,
          notes: e.notes?.trim() || undefined,
          creatorName: e.creatorName?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        }
      })
      await expensesCol.bulkInsert(docs)
      showToast(`Добавлено расходов: ${docs.length}`, 'success')
      onClose()
    } catch (err) {
      console.error('Failed to bulk insert expenses:', err)
      showToast('Не удалось добавить расходы', 'error')
    } finally {
      setSaving(false)
    }
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); setError('') }
    e.target.value = ''
  }

  const onPickTxt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      try { setText(await f.text()); setError('') } catch { setError('Не удалось прочитать файл') }
    }
    e.target.value = ''
  }

  const editingItem = editingId ? items.find((it) => it.id === editingId) ?? null : null

  return (
    <div className="fixed inset-0 z-40 bg-bg flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-separator/15">
        <h2 className="text-[18px] font-bold text-text">
          {step === 'input' ? 'Список расходов' : step === 'reconcile' ? 'Сверка' : 'Проверка'}
        </h2>
        <button onClick={onClose} className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity">
          Закрыть
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {step === 'input' && (
          <>
            {/* Mode segmented control */}
            <div className="flex bg-surface rounded-xl p-1 gap-1">
              {([['text', 'Текст'], ['image', 'Фото'], ['pdf', 'PDF']] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError('') }}
                  className={`flex-1 py-2 rounded-lg text-[14px] font-medium transition-colors ${
                    mode === m ? 'bg-primary text-on-primary' : 'text-text-hint active:bg-bg-secondary/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="text-[13px] text-text-hint px-1">
              Загрузите список трат — приложение распознает строки, сверит их с уже записанными расходами и поможет
              добавить недостающие.
            </p>

            {mode === 'text' ? (
              <div className="space-y-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.currentTarget.value)}
                  placeholder={'Вставьте список, например:\n12.06 Кофе 8.50\n13.06 Продукты 45.20\n...'}
                  className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow resize-none"
                  rows={8}
                />
                <button
                  onClick={() => txtInputRef.current?.click()}
                  className="text-[13px] text-primary-text font-medium active:opacity-60 transition-opacity"
                >
                  …или загрузить .txt
                </button>
                <input ref={txtInputRef} type="file" accept=".txt,text/plain" hidden onChange={onPickTxt} />
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 bg-surface text-text text-[15px] font-medium rounded-2xl active:bg-bg-secondary/50 transition-colors flex items-center justify-center gap-2"
                >
                  {mode === 'image' ? 'Выбрать изображение' : 'Выбрать PDF'}
                </button>
                {file && <p className="text-[13px] text-text-hint px-1 truncate">Выбрано: {file.name}</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={mode === 'image' ? 'image/*' : 'application/pdf,.pdf'}
                  hidden
                  onChange={onPickFile}
                />
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-[13px] text-destructive">
                {error}
              </div>
            )}
          </>
        )}

        {step === 'reconcile' && (
          <>
            <p className="text-[13px] text-text-hint px-1">
              Распознано строк: {items.length}. Уже записанные подсвечены — выберите недостающие для добавления.
            </p>
            <div className="space-y-2">
              {items.map((item, idx) => {
                const m = matches[idx]
                const selected = selectedRowIds.has(item.id)
                const cur = item.row.currency || listCurrency
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border px-3 py-2.5 ${
                      m?.match
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-separator/20 bg-surface'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        onClick={() => toggleRow(item.id)}
                        className={`mt-0.5 w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                          selected ? 'bg-primary border-primary' : 'border-separator'
                        }`}
                      >
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] text-text truncate">{item.row.name}</span>
                          <span className="text-[14px] font-medium text-text shrink-0">{fmtAmount(item.row.amount, cur)}</span>
                        </div>
                        <div className="text-[12px] text-text-hint mt-0.5">{fmtDate(item.row.date)}</div>
                        {m?.match && (
                          <div className="text-[12px] text-green-700 dark:text-green-400 mt-1">
                            Уже есть: {m.match.name || 'Расход'} · {fmtDate(m.match.date)} · {fmtAmount(m.match.amount, m.match.currency)}
                          </div>
                        )}
                      </div>
                    </div>

                    {selected && (
                      <div className="flex items-center gap-2 mt-2 pl-[30px]">
                        <input
                          type="text"
                          value={sharedByRawName[item.row.name]?.customName ?? (item.row.matchedLabel || item.row.name)}
                          onChange={(e) => setQuickName(item.row.name, e.currentTarget.value)}
                          placeholder="Название"
                          className="flex-1 min-w-0 bg-bg-secondary/40 rounded-lg px-3 py-1.5 text-[14px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 outline-none transition-shadow"
                        />
                        <button
                          onClick={() => setEditingId(item.id)}
                          aria-label="Детали"
                          title="Детали"
                          className="shrink-0 w-8 h-8 rounded-lg bg-bg-secondary/40 flex items-center justify-center text-text-hint active:opacity-60 transition-opacity"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <p className="text-[13px] text-text-hint px-1">
              Будет добавлено расходов: {selectedItems.length}. Проверьте перед сохранением.
            </p>
            <div className="space-y-2">
              {selectedItems.map((item) => {
                const eff = effective(item)
                const cat = eff.categoryId ? categories.find((c) => c.id === eff.categoryId) : null
                const store = eff.storeId ? storeById.get(eff.storeId) : null
                return (
                  <div key={item.id} className="rounded-2xl border border-separator/20 bg-surface px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] text-text truncate">{eff.name || 'Расход'}</span>
                      <span className="text-[14px] font-medium text-text shrink-0">
                        {fmtAmount(parseFloat(eff.amount) || 0, eff.currency)}
                      </span>
                    </div>
                    <div className="text-[12px] text-text-hint mt-0.5">
                      {fmtDate(eff.date)}
                      {cat && <span> · {cat.name}</span>}
                      {store && <span> · {store.name}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-separator/15 flex gap-2">
        {step === 'input' && (
          <button
            onClick={handleParse}
            disabled={parsing}
            className="flex-1 bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[16px] disabled:opacity-30 active:opacity-80 transition-opacity"
          >
            {parsing ? 'Распознаём…' : 'Распознать'}
          </button>
        )}
        {step === 'reconcile' && (
          <>
            <button
              onClick={() => setStep('input')}
              className="px-5 py-3.5 text-primary-text font-medium active:opacity-60 transition-opacity"
            >
              Назад
            </button>
            <button
              onClick={() => setStep('review')}
              disabled={selectedItems.length === 0}
              className="flex-1 bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[16px] disabled:opacity-30 active:opacity-80 transition-opacity"
            >
              Далее ({selectedItems.length})
            </button>
          </>
        )}
        {step === 'review' && (
          <>
            <button
              onClick={() => setStep('reconcile')}
              className="px-5 py-3.5 text-primary-text font-medium active:opacity-60 transition-opacity"
            >
              Назад
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || selectedItems.length === 0}
              className="flex-1 bg-primary text-on-primary py-3.5 rounded-2xl font-semibold text-[16px] disabled:opacity-30 active:opacity-80 transition-opacity"
            >
              {saving ? 'Добавляем…' : `Добавить ${selectedItems.length}`}
            </button>
          </>
        )}
      </div>

      {editingItem && (
        <BulkRowDetailEditor
          rawName={editingItem.row.name}
          siblingCount={rawNameCounts.get(editingItem.row.name) ?? 1}
          initial={(() => {
            const e = effective(editingItem)
            return {
              name: e.name,
              amount: e.amount,
              currency: e.currency,
              date: e.date,
              storeId: e.storeId,
              categoryId: e.categoryId,
              notes: e.notes,
              creatorName: e.creatorName,
            }
          })()}
          stores={stores}
          categories={categories}
          expenses={expensesAll}
          onCreateStore={handleCreateStore}
          onCreateCategory={handleCreateCategory}
          roomId={roomId}
          onSave={(shared, row) => handleDetailSave(editingItem, shared, row)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}
