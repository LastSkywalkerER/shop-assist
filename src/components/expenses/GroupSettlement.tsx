import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  SplitGroupDocument,
  ExpenseParticipantDocument,
  ExpenseSettlementDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  CurrencyRateDocument,
} from '../../db/types'
import { showBackButton } from '../../telegram/backButton'
import {
  computeCategorySettlement,
  computePersonExpenseBreakdown,
  allocateSettlement,
  buildItemTotals,
  type ParticipantInput,
  type ExpenseInput,
  type PersonExpenseEntry,
  type SettlementPayment,
} from '../../lib/expenses/splitting'
import { BASE_CURRENCY } from '../../lib/currency/convert'
import {
  buildSettlementPdf,
  settlementReportFileName,
} from '../../lib/expenses/settlementPdf'
import { downloadPdf } from '../../lib/pdf/generatePdf'
import { CalcInput } from '../shared/CalcInput'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useToast } from '../../contexts/ToastContext'
import { pluralizeExpenses } from '../groups/pluralize'

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

export function GroupSettlement() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showToast } = useToast()

  useEffect(() => showBackButton(() => navigate(-1)), [navigate])

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const groupsCol = useRxCollection<SplitGroupDocument>('splitGroups')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const ratesCol = useRxCollection<CurrencyRateDocument>('currencyRates')
  const settlementsCol = useRxCollection<ExpenseSettlementDocument>('expenseSettlements')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: groups } = useRxQuery(groupsCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: rates } = useRxQuery(ratesCol)
  const { data: allSettlements } = useRxQuery(settlementsCol)

  // A settlement row's `categoryId` is the scope id: a split group id for rows
  // recorded since groups were introduced (see ExpenseSettlementDocument).
  const groupSettlements = useMemo(
    () => allSettlements.filter((s) => s.categoryId === groupId),
    [allSettlements, groupId],
  )

  const [recording, setRecording] = useState<{ from: string; to: string } | null>(null)
  const [amountInput, setAmountInput] = useState('')
  /** Person whose per-expense detail is expanded. */
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  /** Expense whose per-expense repayment input is open, inside `openPerson`. */
  const [payingExpenseId, setPayingExpenseId] = useState<string | null>(null)
  const [expenseAmountInput, setExpenseAmountInput] = useState('')
  /** True while pdfmake is being loaded and the report rendered. */
  const [exporting, setExporting] = useState(false)

  const group = useMemo(
    () => groups.find((g) => g.id === groupId),
    [groups, groupId],
  )

  // Shared inputs for both the group totals and the per-person breakdown, so
  // the two views can never drift apart.
  const splitInputs = useMemo(() => {
    const groupExpenses = expenses.filter((e) => e.splitGroupId === groupId)

    const expenseInputs: ExpenseInput[] = groupExpenses.map((e) => ({
      id: e.id,
      amount: e.amount,
      currency: e.currency,
      creatorName: e.creatorName,
      name: e.name,
      date: e.date,
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

    const groupExpenseIds = new Set(groupExpenses.map((e) => e.id))
    const itemTotalsByExpenseId = buildItemTotals(
      receipts.filter((r) => groupExpenseIds.has(r.expenseId)),
      receiptItems,
    )

    return { expenseInputs, participantsByExpenseId, itemTotalsByExpenseId }
  }, [expenses, allParticipants, receipts, receiptItems, groupId])

  const result = useMemo(() => {
    const payments: SettlementPayment[] = groupSettlements.map((s) => ({
      from: s.fromName,
      to: s.toName,
      amount: s.amount,
    }))

    return computeCategorySettlement(
      splitInputs.expenseInputs,
      splitInputs.participantsByExpenseId,
      splitInputs.itemTotalsByExpenseId,
      rates,
      payments,
    )
  }, [splitInputs, rates, groupSettlements])

  const breakdown = useMemo(
    () =>
      computePersonExpenseBreakdown(
        splitInputs.expenseInputs,
        splitInputs.participantsByExpenseId,
        splitInputs.itemTotalsByExpenseId,
        rates,
      ),
    [splitInputs, rates],
  )

  const startRecording = (from: string, to: string, suggested: number) => {
    setRecording({ from, to })
    setAmountInput(suggested ? suggested.toFixed(2) : '')
  }

  const confirmRecording = async () => {
    if (!recording || !settlementsCol || !groupId) return
    const amount = parseFloat(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) return
    const now = new Date().toISOString()
    await settlementsCol.insert({
      id: crypto.randomUUID(),
      // Scope id: the split group this repayment settles (legacy field name).
      categoryId: groupId,
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

  /** Write new `settledAmount` totals onto a person's participant rows. */
  const patchSettled = async (updates: Map<string, number>) => {
    if (!participantsCol || updates.size === 0) return
    const now = new Date().toISOString()
    for (const [participantId, settledAmount] of updates) {
      const doc = await participantsCol.findOne(participantId).exec()
      if (doc) await doc.patch({ settledAmount, updatedAt: now })
    }
  }

  const startExpensePayment = (entry: PersonExpenseEntry) => {
    setPayingExpenseId(entry.expenseId)
    setExpenseAmountInput(entry.remainingNative ? entry.remainingNative.toFixed(2) : '')
  }

  /** Record a repayment against one expense: adds to `participant.settledAmount`. */
  const confirmExpensePayment = async (entry: PersonExpenseEntry) => {
    const amount = parseFloat(expenseAmountInput)
    if (!Number.isFinite(amount) || amount <= 0) return
    await patchSettled(allocateSettlement(entry.participantRows, amount))
    setPayingExpenseId(null)
    setExpenseAmountInput('')
    showToast(`Записано: ${amount.toFixed(2)} ${entry.currency}`, 'success')
  }

  /** Undo everything recorded as repaid on one expense for this person. */
  const resetExpensePayment = async (entry: PersonExpenseEntry, personName: string) => {
    const ok = await confirm({
      title: 'Сбросить оплату?',
      message: `Отметка «отдал ${entry.participantRows
        .reduce((sum, r) => sum + r.settledNative, 0)
        .toFixed(2)} ${entry.currency}» по расходу «${entry.expenseName}» для ${personName} будет удалена.`,
      confirmLabel: 'Сбросить',
      destructive: true,
    })
    if (!ok) return
    const updates = new Map<string, number>()
    for (const row of entry.participantRows) {
      if (row.settledNative !== 0) updates.set(row.participantId, 0)
    }
    await patchSettled(updates)
    showToast('Оплата сброшена', 'success')
  }

  const togglePerson = (name: string) => {
    setOpenPerson((prev) => (prev === name ? null : name))
    setPayingExpenseId(null)
    setExpenseAmountInput('')
  }

  const base = result.baseCurrency
  const fmt = (n: number) => `${n.toFixed(2)} ${base}`
  const hasData = result.perPerson.length > 0

  /** Render the summary into a PDF file and hand it to the browser. */
  const exportPdf = async () => {
    if (exporting) return
    setExporting(true)
    const generatedAt = new Date()
    try {
      await downloadPdf(
        buildSettlementPdf({
          groupName: group?.name ?? '',
          baseCurrency: base,
          perPerson: result.perPerson,
          transfers: result.transfers,
          breakdown,
          payments: groupSettlements.map((s) => ({
            from: s.fromName,
            to: s.toName,
            amount: s.amount,
          })),
          conversionGap: result.conversionGap,
          generatedAt,
        }),
        settlementReportFileName(group?.name ?? '', generatedAt),
      )
      showToast('PDF сохранён', 'success')
    } catch {
      showToast('Не удалось сформировать PDF', 'error')
    } finally {
      setExporting(false)
    }
  }

  const renderPersonDetail = (personName: string) => {
    const entries = breakdown.get(personName) ?? []
    const personPayments = groupSettlements.filter(
      (s) => s.fromName === personName || s.toName === personName,
    )

    if (entries.length === 0 && personPayments.length === 0) {
      return (
        <div className="px-3.5 pb-3 text-[12px] text-text-hint">
          Нет расходов с участием этого человека.
        </div>
      )
    }

    return (
      <div className="px-2.5 pb-2.5 space-y-1.5">
        {entries.map((entry) => {
          const isPaying = payingExpenseId === entry.expenseId
          const sameCurrency = entry.currency === base
          return (
            <div key={entry.expenseId} className="bg-bg-secondary/40 rounded-xl px-3 py-2.5">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/expenses/${entry.expenseId}`)}
                  className="min-w-0 flex-1 text-left active:opacity-60 transition-opacity"
                >
                  <div className="text-[14px] text-text font-medium truncate">
                    {entry.expenseName}
                  </div>
                  <div className="text-[11px] text-text-hint mt-0.5">
                    {formatDate(entry.date)}
                    {entry.date ? ' · ' : ''}
                    {entry.amountNative.toFixed(2)} {entry.currency}
                    {' · платил '}
                    {entry.payerName}
                  </div>
                </button>
                <div
                  className={`text-[14px] font-semibold tabular-nums shrink-0 ${
                    entry.net > 0
                      ? 'text-green-600 dark:text-green-400'
                      : entry.net < 0
                        ? 'text-destructive'
                        : 'text-text-hint'
                  }`}
                >
                  {entry.net > 0 ? '+' : ''}{fmt(entry.net)}
                </div>
              </div>

              <div className="text-[11px] text-text-hint mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {entry.isPayer && <span>Оплатил {fmt(entry.paid)}</span>}
                <span>Доля {fmt(entry.share)}</span>
                {entry.settled > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    Отдал {fmt(entry.settled)}
                  </span>
                )}
                {entry.isPayer && entry.received > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    Вернули {fmt(entry.received)}
                  </span>
                )}
                {!entry.isPayer && entry.remaining > 0 && (
                  <span className="text-destructive">Осталось {fmt(entry.remaining)}</span>
                )}
              </div>

              {!entry.isPayer && entry.participantRows.length > 0 && (
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      isPaying ? setPayingExpenseId(null) : startExpensePayment(entry)
                    }
                    disabled={entry.remainingNative <= 0 && !isPaying}
                    className="text-[13px] font-medium text-primary-text px-2 py-1 -ml-2 rounded-lg active:bg-primary/10 transition-colors disabled:opacity-40"
                  >
                    {isPaying ? 'Отмена' : entry.remainingNative > 0 ? 'Отдал' : 'Погашено'}
                  </button>
                  {entry.settled > 0 && !isPaying && (
                    <button
                      type="button"
                      onClick={() => void resetExpensePayment(entry, personName)}
                      className="text-[13px] font-medium text-text-hint px-2 py-1 rounded-lg active:bg-destructive/10 transition-colors"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              )}

              {isPaying && (
                <div className="flex items-start gap-2 mt-2">
                  <CalcInput
                    autoFocus
                    value={expenseAmountInput}
                    onChange={setExpenseAmountInput}
                    min={0}
                    wrapperClassName="flex-1 min-w-0"
                    className="w-full bg-surface rounded-xl px-3 py-2 text-[14px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow text-right tabular-nums"
                  />
                  <span className="text-[13px] text-text-hint py-2">{entry.currency}</span>
                  <button
                    type="button"
                    onClick={() => void confirmExpensePayment(entry)}
                    className="shrink-0 bg-primary text-on-primary px-4 py-2 rounded-xl text-[14px] font-semibold active:opacity-80 transition-opacity"
                  >
                    Записать
                  </button>
                </div>
              )}

              {isPaying && !sameCurrency && (
                <p className="text-[11px] text-text-hint mt-1">
                  Сумма записывается в валюте расхода ({entry.currency}).
                </p>
              )}
            </div>
          )
        })}

        {personPayments.length > 0 && (
          <div className="pt-1">
            <div className="text-[11px] text-text-hint px-1 pb-1">Переводы по группе</div>
            {personPayments.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-hint"
              >
                <span className="truncate">
                  {s.fromName} → {s.toName}
                </span>
                <span className="ml-auto tabular-nums shrink-0">{fmt(s.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      <div className="p-4 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold text-text">Сводка по расходам</h2>
          {group && <p className="text-[14px] text-text-hint mt-0.5 truncate">{group.name}</p>}
        </div>
        {hasData && (
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={exporting}
            className="shrink-0 flex items-center gap-1.5 bg-surface text-primary-text px-3 py-1.5 rounded-xl text-[13px] font-medium active:opacity-70 transition-opacity disabled:opacity-50"
            title="Экспорт сводки в PDF"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            {exporting ? '…' : 'PDF'}
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="px-4 mt-4 text-[15px] text-text-hint">
          В этой группе пока нет расходов с участниками. Откройте расход, укажите
          группу разделения и нажмите «Разделить расход», чтобы добавить участников.
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
              {result.perPerson.map((person) => {
                const isOpen = openPerson === person.name
                const entryCount = (breakdown.get(person.name) ?? []).length
                return (
                  <div key={person.name} className="bg-surface rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => togglePerson(person.name)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left active:bg-bg-secondary/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-text truncate">{person.name}</div>
                        <div className="text-[12px] text-text-hint mt-0.5">
                          Потратил {fmt(person.paid)} · доля {fmt(person.share)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div
                          className={`text-[15px] font-semibold tabular-nums ${
                            person.net > 0
                              ? 'text-green-600 dark:text-green-400'
                              : person.net < 0
                                ? 'text-destructive'
                                : 'text-text-hint'
                          }`}
                        >
                          {person.net > 0 ? '+' : ''}{fmt(person.net)}
                        </div>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`text-text-hint transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>
                    </button>
                    {isOpen && renderPersonDetail(person.name)}
                    {!isOpen && entryCount > 0 && (
                      <div className="px-3.5 pb-2 -mt-1 text-[11px] text-text-hint">
                        {pluralizeExpenses(entryCount)} — нажмите, чтобы раскрыть детали
                      </div>
                    )}
                  </div>
                )
              })}
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
                        <div className="flex items-start gap-2 mt-2">
                          <CalcInput
                            autoFocus
                            value={amountInput}
                            onChange={setAmountInput}
                            min={0}
                            wrapperClassName="flex-1 min-w-0"
                            className="w-full bg-bg-secondary/40 rounded-xl px-3 py-2 text-[15px] text-text focus:ring-2 focus:ring-primary/30 transition-shadow text-right tabular-nums"
                          />
                          <span className="text-[13px] text-text-hint py-2">{base}</span>
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
          {groupSettlements.length > 0 && (
            <div className="px-4 mt-5">
              <div className="text-[13px] text-section-header font-medium pl-1 mb-2">Записанные оплаты</div>
              <div className="space-y-2">
                {groupSettlements.map((s) => (
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
