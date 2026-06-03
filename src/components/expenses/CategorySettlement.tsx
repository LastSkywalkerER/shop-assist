import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  ExpenseCategoryDocument,
  ExpenseParticipantDocument,
  ExpenseSettlementDocument,
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
  type SettlementPayment,
} from '../../lib/expenses/splitting'
import { BASE_CURRENCY } from '../../lib/currency/convert'

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
  const settlementsCol = useRxCollection<ExpenseSettlementDocument>('expenseSettlements')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)
  const { data: allSettlements } = useRxQuery(settlementsCol)

  const categorySettlements = useMemo(
    () => allSettlements.filter((s) => s.categoryId === categoryId),
    [allSettlements, categoryId],
  )

  const [recording, setRecording] = useState<{ from: string; to: string } | null>(null)
  const [amountInput, setAmountInput] = useState('')

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

    const payments: SettlementPayment[] = categorySettlements.map((s) => ({
      from: s.fromName,
      to: s.toName,
      amount: s.amount,
    }))

    return computeCategorySettlement(expenseInputs, participantsByExpenseId, itemTotalsByExpenseId, rates, payments)
  }, [expenses, allParticipants, receipts, receiptItems, rates, categorySettlements, categoryId])

  const startRecording = (from: string, to: string, suggested: number) => {
    setRecording({ from, to })
    setAmountInput(suggested ? suggested.toFixed(2) : '')
  }

  const confirmRecording = async () => {
    if (!recording || !settlementsCol || !categoryId) return
    const amount = parseFloat(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) return
    const now = new Date().toISOString()
    await settlementsCol.insert({
      id: crypto.randomUUID(),
      categoryId,
      fromName: recording.from,
      toName: recording.to,
      amount: parseFloat(amount.toFixed(2)),
      currency: BASE_CURRENCY,
      createdAt: now,
      updatedAt: now,
    })
    setRecording(null)
    setAmountInput('')
  }

  const deleteSettlement = async (id: string) => {
    if (!settlementsCol) return
    const doc = await settlementsCol.findOne(id).exec()
    if (doc) await doc.remove()
  }

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
          {result.transfers.length > 0 ? (
            <div className="px-4 mt-5">
              <div className="text-[13px] text-section-header font-medium pl-1 mb-2">Кто кому переводит</div>
              <div className="space-y-2">
                {result.transfers.map((t, i) => {
                  const isRecording = recording?.from === t.from && recording?.to === t.to
                  return (
                    <div key={i} className="bg-surface rounded-2xl px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] text-text font-medium truncate">{t.from}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-hint shrink-0">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                        <span className="text-[15px] text-text font-medium truncate">{t.to}</span>
                        <span className="ml-auto text-[15px] font-semibold text-text tabular-nums shrink-0">{fmt(t.amount)}</span>
                        <button
                          type="button"
                          onClick={() => (isRecording ? setRecording(null) : startRecording(t.from, t.to, t.amount))}
                          className="shrink-0 text-[13px] font-medium text-primary-text px-2 py-1 rounded-lg active:bg-primary/10 transition-colors"
                        >
                          {isRecording ? 'Отмена' : 'Отдал'}
                        </button>
                      </div>
                      {isRecording && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            autoFocus
                            value={amountInput}
                            onChange={(e) => setAmountInput(e.currentTarget.value)}
                            className="flex-1 min-w-0 bg-bg-secondary/40 rounded-xl px-3 py-2 text-[15px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow text-right tabular-nums"
                          />
                          <span className="text-[13px] text-text-hint">{base}</span>
                          <button
                            type="button"
                            onClick={confirmRecording}
                            className="shrink-0 bg-primary text-on-primary px-4 py-2 rounded-xl text-[14px] font-semibold active:opacity-80 transition-opacity"
                          >
                            Записать
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="px-4 mt-5 text-[14px] text-text-hint">Все долги погашены 🎉</div>
          )}

          {/* Recorded repayments */}
          {categorySettlements.length > 0 && (
            <div className="px-4 mt-5">
              <div className="text-[13px] text-section-header font-medium pl-1 mb-2">Записанные оплаты</div>
              <div className="space-y-2">
                {categorySettlements.map((s) => (
                  <div key={s.id} className="bg-surface rounded-2xl px-3.5 py-2.5 flex items-center gap-2">
                    <span className="text-[14px] text-text truncate">{s.fromName}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-hint shrink-0">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    <span className="text-[14px] text-text truncate">{s.toName}</span>
                    <span className="ml-auto text-[14px] font-medium text-text tabular-nums shrink-0">{fmt(s.amount)}</span>
                    <button
                      type="button"
                      onClick={() => deleteSettlement(s.id)}
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                      title="Удалить"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
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
