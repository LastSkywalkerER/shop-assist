import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  ExpenseParticipantDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  CurrencyRateDocument,
} from '../../db/types'
import { showBackButton } from '../../telegram/backButton'
import {
  computeCategorySettlement,
  lineItemTotal,
  type ParticipantInput,
  type ExpenseInput,
} from '../../lib/expenses/splitting'

export function CategorySettlement() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()

  useEffect(() => showBackButton(() => navigate(-1)), [navigate])

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  )

  const result = useMemo(() => {
    const categoryExpenses = expenses.filter((e) => e.categoryId === categoryId)

    const expenseInputs: ExpenseInput[] = categoryExpenses.map((e) => ({
      id: e.id,
      amount: e.amount,
      currency: e.currency,
      creatorName: e.creatorName,
    }))

    const participantsByExpenseId = new Map<string, ParticipantInput[]>()
    for (const p of allParticipants) {
      const list = participantsByExpenseId.get(p.expenseId) ?? []
      list.push({
        id: p.id,
        name: p.name,
        shareMode: p.shareMode,
        shareAmount: p.shareAmount,
        itemIds: p.itemIds,
        settledAmount: p.settledAmount,
      })
      participantsByExpenseId.set(p.expenseId, list)
    }

    // itemId -> line total, grouped per expense via its receipt.
    const receiptByExpense = new Map(receipts.map((r) => [r.expenseId, r]))
    const itemsByReceipt = new Map<string, ReceiptItemDocument[]>()
    for (const it of receiptItems) {
      const list = itemsByReceipt.get(it.receiptId) ?? []
      list.push(it)
      itemsByReceipt.set(it.receiptId, list)
    }
    const itemTotalsByExpenseId = new Map<string, Map<string, number>>()
    for (const e of categoryExpenses) {
      const receipt = receiptByExpense.get(e.id)
      if (!receipt) continue
      const totals = new Map<string, number>()
      for (const it of itemsByReceipt.get(receipt.id) ?? []) {
        totals.set(it.id, lineItemTotal(it))
      }
      itemTotalsByExpenseId.set(e.id, totals)
    }

    return computeCategorySettlement(expenseInputs, participantsByExpenseId, itemTotalsByExpenseId, rates)
  }, [expenses, allParticipants, receipts, receiptItems, rates, categoryId])

  const base = result.baseCurrency
  const fmt = (n: number) => `${n.toFixed(2)} ${base}`
  const hasData = result.perPerson.length > 0

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2">
        <h2 className="text-[20px] font-bold text-text">Сводка по расходам</h2>
        {category && <p className="text-[14px] text-text-hint mt-0.5">{category.name}</p>}
      </div>

      {!hasData ? (
        <div className="px-4 mt-4 text-[15px] text-text-hint">
          В этой категории пока нет расходов с участниками. Откройте расход и нажмите
          «Разделить расход», чтобы добавить участников.
        </div>
      ) : (
        <>
          {result.conversionGap && (
            <div className="mx-4 mt-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 text-[12px] text-yellow-700 dark:text-yellow-400">
              Для некоторых валют нет курса — эти суммы не учтены в пересчёте в {base}.
            </div>
          )}

          {/* Per-person balances */}
          <div className="px-4 mt-4">
            <div className="text-[13px] text-section-header font-medium pl-1 mb-2">Баланс участников</div>
            <div className="space-y-2">
              {result.perPerson.map((person) => (
                <div key={person.name} className="bg-surface rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-text truncate">{person.name}</div>
                    <div className="text-[12px] text-text-hint mt-0.5">
                      Потратил {fmt(person.paid)} · доля {fmt(person.share)}
                    </div>
                  </div>
                  <div
                    className={`text-[15px] font-semibold tabular-nums shrink-0 ${
                      person.net > 0
                        ? 'text-green-600 dark:text-green-400'
                        : person.net < 0
                          ? 'text-destructive'
                          : 'text-text-hint'
                    }`}
                  >
                    {person.net > 0 ? '+' : ''}{fmt(person.net)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-text-hint mt-2 pl-1">
              Зелёным — сколько человеку должны, красным — сколько он должен.
            </p>
          </div>

          {/* Who pays whom */}
          {result.transfers.length > 0 && (
            <div className="px-4 mt-5">
              <div className="text-[13px] text-section-header font-medium pl-1 mb-2">Кто кому переводит</div>
              <div className="space-y-2">
                {result.transfers.map((t, i) => (
                  <div key={i} className="bg-surface rounded-2xl px-3.5 py-2.5 flex items-center gap-2">
                    <span className="text-[15px] text-text font-medium truncate">{t.from}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-hint shrink-0">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    <span className="text-[15px] text-text font-medium truncate">{t.to}</span>
                    <span className="ml-auto text-[15px] font-semibold text-text tabular-nums shrink-0">{fmt(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
