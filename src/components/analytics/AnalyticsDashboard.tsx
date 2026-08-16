import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { ExpenseCategoryDocument, SuperCategoryDocument } from '../../db/types'
import { useExpenseAnalytics } from '../../hooks/useExpenseAnalytics'
import { useExpenseGroups } from '../../hooks/useExpenseGroups'
import { BASE_CURRENCY } from '../../lib/currency/convert'
import type { AnalyticsPeriod } from '../../lib/analytics/aggregate'
import { AnalyticsConfigPanel } from './AnalyticsConfigPanel'
import { SpendingLineChart } from './SpendingLineChart'
import { PieCard } from './PieCard'

const fmtMoney = (n: number) => `${n.toFixed(2)} ${BASE_CURRENCY}`
const fmtCount = (n: number) => `${Math.round(n)} раз`

export function AnalyticsDashboard() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<AnalyticsPeriod>({ mode: 'all' })
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set())
  const [selectedSuperCategoryId, setSelectedSuperCategoryId] = useState<string | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const superCategoriesCol = useRxCollection<SuperCategoryDocument>('superCategories')
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: superCategories } = useRxQuery(superCategoriesCol)
  const { groups: expenseGroups } = useExpenseGroups()

  // Newest first; sorted in memory (createdAt is not indexed).
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [categories],
  )
  const sortedSuperCategories = useMemo(
    () => [...superCategories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [superCategories],
  )
  // Only groups that actually have expenses are worth filtering by.
  const groupNames = useMemo(
    () => expenseGroups.filter((g) => g.count > 0).map((g) => g.name),
    [expenseGroups],
  )

  // A selected super category narrows the category chips to its members.
  const visibleCategories = useMemo(
    () =>
      selectedSuperCategoryId
        ? sortedCategories.filter((c) => c.superCategoryId === selectedSuperCategoryId)
        : sortedCategories,
    [sortedCategories, selectedSuperCategoryId],
  )

  const categoryIds = useMemo(() => [...selectedCategoryIds], [selectedCategoryIds])
  const groupFilter = useMemo(() => [...selectedGroups], [selectedGroups])
  const analytics = useExpenseAnalytics(period, categoryIds, selectedSuperCategoryId, groupFilter)

  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (name: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectSuperCategory = (id: string | null) => {
    setSelectedSuperCategoryId(id)
    // Scope changed — drop the per-category selection.
    setSelectedCategoryIds(new Set())
  }

  const invalidRange = period.mode === 'range' && !analytics.hasBounds

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Аналитика</h2>
        <button
          onClick={() => navigate(-1)}
          className="text-primary-text text-[15px] font-medium active:opacity-60 transition-opacity"
        >
          Назад
        </button>
      </div>

      <div className="px-4 space-y-3">
        <AnalyticsConfigPanel
          period={period}
          onPeriodChange={setPeriod}
          superCategories={sortedSuperCategories}
          selectedSuperCategoryId={selectedSuperCategoryId}
          onSelectSuperCategory={selectSuperCategory}
          categories={visibleCategories}
          selectedCategoryIds={selectedCategoryIds}
          onToggleCategory={toggleCategory}
          onClearCategories={() => setSelectedCategoryIds(new Set())}
          groups={groupNames}
          selectedGroups={selectedGroups}
          onToggleGroup={toggleGroup}
          onClearGroups={() => setSelectedGroups(new Set())}
        />

        <p className="text-[11px] text-text-hint px-1 leading-snug">
          Разделённые расходы учитываются по суммам, которые участники румы
          фактически отдали, а не по всему чеку плательщика.
        </p>

        {analytics.conversionGaps > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 text-[12px] text-yellow-700 dark:text-yellow-400">
            Не удалось сконвертировать {analytics.conversionGaps}{' '}
            {analytics.conversionGaps === 1 ? 'сумму' : 'сумм(ы)'} — нет курса валюты.
          </div>
        )}

        {invalidRange ? (
          <div className="bg-surface rounded-2xl px-4 py-6 text-center text-[13px] text-text-hint">
            Начальная дата позже конечной — поправьте период.
          </div>
        ) : (
          <>
            <SpendingLineChart
              series={analytics.series}
              granularity={analytics.granularity}
              average={analytics.average}
              maxKey={analytics.maxKey}
            />

            <PieCard
              title={
                analytics.byCategoryDimension === 'super'
                  ? 'Распределение по суперкатегориям'
                  : 'Распределение по категориям'
              }
              data={analytics.pies.byCategory}
              valueFormatter={fmtMoney}
              bars={analytics.bars.byCategory}
              barGranularity={analytics.barGranularity}
            />
            {groupNames.length > 0 && (
              <PieCard
                title="Распределение по группам"
                data={analytics.pies.byGroup}
                valueFormatter={fmtMoney}
                bars={analytics.bars.byGroup}
                barGranularity={analytics.barGranularity}
              />
            )}
            <PieCard
              title="Самые дорогие расходы"
              data={analytics.pies.expensiveExpenses}
              valueFormatter={fmtMoney}
              bars={analytics.bars.expensiveExpenses}
              barGranularity={analytics.barGranularity}
            />
            <PieCard
              title="Самые частые расходы"
              data={analytics.pies.frequentExpenses}
              valueFormatter={fmtCount}
              bars={analytics.bars.frequentExpenses}
              barGranularity={analytics.barGranularity}
            />
            <PieCard
              title="Самые дорогие позиции чеков"
              data={analytics.pies.expensiveItems}
              valueFormatter={fmtMoney}
              emptyText="Нет позиций чеков за период"
              bars={analytics.bars.expensiveItems}
              barGranularity={analytics.barGranularity}
            />
            <PieCard
              title="Самые частые позиции чеков"
              data={analytics.pies.frequentItems}
              valueFormatter={fmtCount}
              emptyText="Нет позиций чеков за период"
              bars={analytics.bars.frequentItems}
              barGranularity={analytics.barGranularity}
            />
          </>
        )}
      </div>
    </div>
  )
}
