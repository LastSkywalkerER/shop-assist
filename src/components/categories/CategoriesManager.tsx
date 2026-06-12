import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseCategoryDocument,
  SuperCategoryDocument,
  ExpenseDocument,
} from '../../db/types'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useToast } from '../../contexts/ToastContext'

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return `${n} ${many}`
  if (mod10 === 1) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`
  return `${n} ${many}`
}

const sectionTitleClass =
  'text-[12px] font-semibold uppercase tracking-wide text-section-header'

/** Inline create row shared by both sections. */
function CreateRow({ placeholder, onCreate }: { placeholder: string; onCreate: (name: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const name = value.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await onCreate(name)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-surface rounded-xl px-4 py-2.5 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!value.trim() || busy}
        className="shrink-0 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-[14px] font-semibold disabled:opacity-30 active:opacity-80 transition-opacity"
      >
        Создать
      </button>
    </div>
  )
}

/**
 * Management screen for super categories and regular expense categories:
 * create, delete, assign categories to super categories, and merge one
 * category into another (its expenses move to the target).
 */
export function CategoriesManager() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showToast } = useToast()

  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const superCategoriesCol = useRxCollection<SuperCategoryDocument>('superCategories')
  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: superCategories } = useRxQuery(superCategoriesCol)
  const { data: expenses } = useRxQuery(expensesCol)

  /** Source category of an in-progress merge; rows become merge targets. */
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)

  // Newest first; sorted in memory (createdAt is not indexed).
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [categories],
  )
  const sortedSuperCategories = useMemo(
    () => [...superCategories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [superCategories],
  )

  const expenseCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of expenses) {
      if (e.categoryId) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1)
    }
    return counts
  }, [expenses])

  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of categories) {
      if (c.superCategoryId) counts.set(c.superCategoryId, (counts.get(c.superCategoryId) ?? 0) + 1)
    }
    return counts
  }, [categories])

  const mergeSource = mergeSourceId ? categories.find((c) => c.id === mergeSourceId) ?? null : null

  const createSuperCategory = async (name: string) => {
    if (!superCategoriesCol) return
    const now = new Date().toISOString()
    await superCategoriesCol.insert({ id: crypto.randomUUID(), name, createdAt: now, updatedAt: now })
  }

  const createCategory = async (name: string) => {
    if (!categoriesCol) return
    const now = new Date().toISOString()
    await categoriesCol.insert({ id: crypto.randomUUID(), name, createdAt: now, updatedAt: now })
  }

  const deleteSuperCategory = async (sup: SuperCategoryDocument) => {
    if (!superCategoriesCol || !categoriesCol) return
    const ok = await confirm({
      title: `Удалить суперкатегорию «${sup.name}»?`,
      message: 'Категории внутри неё сохранятся, но останутся без суперкатегории.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    })
    if (!ok) return
    const now = new Date().toISOString()
    const members = await categoriesCol.find({ selector: { superCategoryId: sup.id } }).exec()
    for (const member of members) {
      await member.patch({ superCategoryId: undefined, updatedAt: now })
    }
    const doc = await superCategoriesCol.findOne(sup.id).exec()
    if (doc) await doc.remove()
    showToast(`Суперкатегория «${sup.name}» удалена`, 'success')
  }

  const assignSuperCategory = async (cat: ExpenseCategoryDocument, superId: string) => {
    if (!categoriesCol) return
    const doc = await categoriesCol.findOne(cat.id).exec()
    if (doc) {
      await doc.patch({ superCategoryId: superId || undefined, updatedAt: new Date().toISOString() })
    }
  }

  const deleteCategory = async (cat: ExpenseCategoryDocument) => {
    if (!categoriesCol) return
    const count = expenseCounts.get(cat.id) ?? 0
    const ok = await confirm({
      title: `Удалить категорию «${cat.name}»?`,
      message:
        count > 0
          ? `${pluralize(count, 'расход останется', 'расхода останутся', 'расходов останутся')} без категории.`
          : 'Расходов в этой категории нет.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    })
    if (!ok) return
    if (mergeSourceId === cat.id) setMergeSourceId(null)
    const doc = await categoriesCol.findOne(cat.id).exec()
    if (doc) await doc.remove()
    showToast(`Категория «${cat.name}» удалена`, 'success')
  }

  const mergeInto = async (target: ExpenseCategoryDocument) => {
    if (!mergeSource || !categoriesCol || !expensesCol || target.id === mergeSource.id) return
    const count = expenseCounts.get(mergeSource.id) ?? 0
    const ok = await confirm({
      title: `Объединить «${mergeSource.name}» с «${target.name}»?`,
      message: `${pluralize(count, 'расход перейдёт', 'расхода перейдут', 'расходов перейдут')} в «${target.name}», категория «${mergeSource.name}» будет удалена.`,
      confirmLabel: 'Объединить',
      cancelLabel: 'Отмена',
      destructive: true,
    })
    if (!ok) return
    const now = new Date().toISOString()
    const docs = await expensesCol.find({ selector: { categoryId: mergeSource.id } }).exec()
    for (const doc of docs) {
      await doc.patch({ categoryId: target.id, updatedAt: now })
    }
    const sourceDoc = await categoriesCol.findOne(mergeSource.id).exec()
    if (sourceDoc) await sourceDoc.remove()
    setMergeSourceId(null)
    showToast(`Категории объединены в «${target.name}»`, 'success')
  }

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Категории</h2>
        <button
          onClick={() => navigate(-1)}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      {/* Super categories */}
      <div className="px-4 pt-2 pb-1.5">
        <span className={sectionTitleClass}>Суперкатегории</span>
      </div>
      <div className="px-4 space-y-2">
        <CreateRow placeholder="Новая суперкатегория..." onCreate={createSuperCategory} />
        {sortedSuperCategories.length === 0 ? (
          <div className="bg-surface rounded-2xl px-4 py-5 text-center text-[13px] text-text-hint">
            Суперкатегории объединяют категории в крупные группы — аналитика по
            умолчанию строится по ним.
          </div>
        ) : (
          sortedSuperCategories.map((sup) => (
            <div key={sup.id} className="bg-surface rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-text truncate">{sup.name}</div>
                <div className="text-[12px] text-text-hint mt-0.5">
                  {pluralize(memberCounts.get(sup.id) ?? 0, 'категория', 'категории', 'категорий')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void deleteSuperCategory(sup)}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                title="Удалить суперкатегорию"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Categories */}
      <div className="px-4 pt-5 pb-1.5">
        <span className={sectionTitleClass}>Категории</span>
      </div>
      <div className="px-4 space-y-2">
        <CreateRow placeholder="Новая категория..." onCreate={createCategory} />

        {mergeSource && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span className="text-[12px] text-text flex-1 min-w-0">
              Выберите категорию, в которую перенести расходы из «{mergeSource.name}»
            </span>
            <button
              type="button"
              onClick={() => setMergeSourceId(null)}
              className="text-[13px] text-primary-text font-medium shrink-0 active:opacity-60 transition-opacity"
            >
              Отмена
            </button>
          </div>
        )}

        {sortedCategories.length === 0 ? (
          <div className="bg-surface rounded-2xl px-4 py-5 text-center text-[13px] text-text-hint">
            Категорий пока нет. Они также создаются прямо в форме расхода.
          </div>
        ) : (
          sortedCategories.map((cat) => {
            const isMergeSource = mergeSourceId === cat.id
            const isMergeTarget = mergeSource != null && !isMergeSource
            return (
              <div
                key={cat.id}
                className={`bg-surface rounded-2xl px-4 py-3 space-y-2.5 transition-colors ${
                  isMergeSource ? 'ring-2 ring-primary/40' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium text-text truncate">{cat.name}</div>
                    <div className="text-[12px] text-text-hint mt-0.5">
                      {pluralize(expenseCounts.get(cat.id) ?? 0, 'расход', 'расхода', 'расходов')}
                    </div>
                  </div>
                  {isMergeTarget ? (
                    <button
                      type="button"
                      onClick={() => void mergeInto(cat)}
                      className="shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-full text-[13px] font-semibold active:opacity-80 transition-opacity"
                    >
                      Сюда
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setMergeSourceId(isMergeSource ? null : cat.id)}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-primary-text active:bg-primary/10 transition-colors"
                        title="Объединить с другой категорией"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 7h12" />
                          <path d="m16 3 4 4-4 4" />
                          <path d="M16 17H4" />
                          <path d="m8 13-4 4 4 4" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCategory(cat)}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                        title="Удалить категорию"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Super-category assignment */}
                {superCategories.length > 0 && (
                  <select
                    value={cat.superCategoryId ?? ''}
                    onChange={(e) => void assignSuperCategory(cat, e.currentTarget.value)}
                    className="w-full bg-bg-secondary/40 rounded-xl px-3 py-2 text-[13px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow appearance-none"
                  >
                    <option value="">Без суперкатегории</option>
                    {sortedSuperCategories.map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
