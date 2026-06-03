import { useMemo, useState, useEffect, useId } from 'react'
import type { ExpenseShareMode } from '../../db/types'
import { useRoomMembers } from '../../hooks/useRoomMembers'
import { computeShares, lineItemTotal, type ParticipantInput } from '../../lib/expenses/splitting'

/** Local editable shape for a participant (matches ParticipantInput). */
export interface SplitParticipant {
  id: string
  name: string
  shareMode: ExpenseShareMode
  shareAmount?: number
  itemIds?: string[]
  settledAmount?: number
}

interface SplitItem {
  id: string
  name: string
  amount: number
  quantity?: number
}

interface ExpenseSplitManagerProps {
  participants: SplitParticipant[]
  onChange: (next: SplitParticipant[]) => void
  /** Expense total, for the live share preview. */
  expenseAmount: number
  currency: string
  /** Receipt line-items available for `items`-mode shares. */
  receiptItems: SplitItem[]
  /** Main payer (expense.creatorName); seeded as the first equal participant. */
  payerName: string
  /** Distinct participant names already used in this expense's category;
   *  seeded as equal-split participants when the split is opened empty. */
  categoryParticipantNames?: string[]
  roomId: string | null
}

const MODES: Array<{ value: ExpenseShareMode; label: string }> = [
  { value: 'equal', label: 'Поровну' },
  { value: 'amount', label: 'Сумма' },
  { value: 'items', label: 'Позиции' },
]

export function ExpenseSplitManager({
  participants,
  onChange,
  expenseAmount,
  currency,
  receiptItems,
  payerName,
  categoryParticipantNames = [],
  roomId,
}: ExpenseSplitManagerProps) {
  const [expanded, setExpanded] = useState(participants.length > 0)
  const { roomUsers, customNames } = useRoomMembers(roomId)
  const datalistId = useId()

  // Expand once participants arrive (e.g. loaded async on the edit screen).
  useEffect(() => {
    if (participants.length > 0) setExpanded(true)
  }, [participants.length])

  // When the split is opened empty, seed the payer plus everyone already used
  // in this category — all defaulting to an equal split.
  useEffect(() => {
    if (!(expanded && participants.length === 0)) return
    const payer = payerName.trim() || 'Плательщик'
    const seeded: SplitParticipant[] = [{ id: crypto.randomUUID(), name: payer, shareMode: 'equal' }]
    const seen = new Set([payer.toLowerCase()])
    for (const raw of categoryParticipantNames) {
      const name = raw.trim()
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase())
        seeded.push({ id: crypto.randomUUID(), name, shareMode: 'equal' })
      }
    }
    onChange(seeded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const nameSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const u of roomUsers) set.add(u.displayName)
    for (const n of customNames) set.add(n)
    return Array.from(set)
  }, [roomUsers, customNames])

  const itemTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of receiptItems) m.set(it.id, lineItemTotal(it))
    return m
  }, [receiptItems])

  const preview = useMemo(
    () => computeShares(expenseAmount, participants as ParticipantInput[], itemTotals),
    [expenseAmount, participants, itemTotals],
  )

  const update = (id: string, patch: Partial<SplitParticipant>) => {
    onChange(participants.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const remove = (id: string) => {
    onChange(participants.filter((p) => p.id !== id))
  }

  const add = () => {
    onChange([...participants, { id: crypto.randomUUID(), name: '', shareMode: 'equal' }])
  }

  const fmt = (n: number) => `${n.toFixed(2)} ${currency}`

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full py-3 bg-surface text-text text-[15px] font-medium rounded-2xl active:bg-bg-secondary/50 transition-colors flex items-center justify-center gap-2"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Разделить расход
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[13px] text-section-header font-medium pl-1">
          Кто участвует в расходе
        </label>
        <span className="text-[12px] text-text-hint">Платил: {payerName.trim() || '—'}</span>
      </div>

      <datalist id={datalistId}>
        {nameSuggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {participants.map((p) => {
        const share = preview.shares.get(p.id) ?? 0
        return (
          <div key={p.id} className="bg-surface rounded-2xl px-3.5 py-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={p.name}
                list={datalistId}
                onChange={(e) => update(p.id, { name: e.currentTarget.value })}
                placeholder="Имя участника..."
                className="flex-1 min-w-0 bg-bg-secondary/40 rounded-xl px-3 py-2 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
              />
              <span className="text-[13px] text-text-hint tabular-nums shrink-0">{fmt(share)}</span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                title="Удалить"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>

            {/* Mode segmented control */}
            <div className="flex gap-1 bg-bg-secondary/40 rounded-xl p-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => update(p.id, { shareMode: m.value })}
                  className={`flex-1 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    p.shareMode === m.value
                      ? 'bg-primary text-on-primary'
                      : 'text-text-hint active:bg-bg-secondary/60'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {p.shareMode === 'amount' && (
              <input
                type="number"
                inputMode="decimal"
                value={p.shareAmount ?? ''}
                onChange={(e) =>
                  update(p.id, { shareAmount: e.currentTarget.value === '' ? undefined : parseFloat(e.currentTarget.value) })
                }
                placeholder={`Сумма доли, ${currency}`}
                className="w-full bg-bg-secondary/40 rounded-xl px-3 py-2 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
              />
            )}

            {p.shareMode === 'items' && (
              receiptItems.length === 0 ? (
                <p className="text-[12px] text-text-hint px-1">
                  Добавьте позиции чека ниже, чтобы выбрать их для участника.
                </p>
              ) : (
                <div className="space-y-1">
                  {receiptItems.map((it) => {
                    const checked = (p.itemIds ?? []).includes(it.id)
                    return (
                      <label key={it.id} className="flex items-center gap-2.5 px-1 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const set = new Set(p.itemIds ?? [])
                            if (e.currentTarget.checked) set.add(it.id)
                            else set.delete(it.id)
                            update(p.id, { itemIds: Array.from(set) })
                          }}
                          className="w-4 h-4 accent-primary shrink-0"
                        />
                        <span className="text-[14px] text-text flex-1 min-w-0 truncate">{it.name}</span>
                        <span className="text-[12px] text-text-hint tabular-nums">{fmt(lineItemTotal(it))}</span>
                      </label>
                    )
                  })}
                </div>
              )
            )}

            {/* Already settled */}
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-text-hint pl-1">Уже отдал</span>
              <input
                type="number"
                inputMode="decimal"
                value={p.settledAmount ?? ''}
                onChange={(e) =>
                  update(p.id, { settledAmount: e.currentTarget.value === '' ? undefined : parseFloat(e.currentTarget.value) })
                }
                placeholder="0"
                className="w-24 bg-bg-secondary/40 rounded-xl px-3 py-1.5 text-[14px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow text-right tabular-nums"
              />
              <span className="text-[13px] text-text-hint">{currency}</span>
            </div>
          </div>
        )
      })}

      {/* Warnings */}
      {preview.overAssigned > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2 text-[12px] text-destructive">
          Доли превышают сумму расхода на {fmt(preview.overAssigned)}.
        </div>
      )}
      {preview.unassigned > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 text-[12px] text-yellow-700 dark:text-yellow-400">
          Не распределено {fmt(preview.unassigned)} — добавьте участника с долей «Поровну».
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="w-full py-3 bg-surface text-text text-[15px] font-medium rounded-2xl active:bg-bg-secondary/50 transition-colors flex items-center justify-center gap-2"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Добавить участника
      </button>
    </div>
  )
}
