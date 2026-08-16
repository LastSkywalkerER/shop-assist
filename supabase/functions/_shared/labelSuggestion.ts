// Deterministic expense-label fallback. Runs when the validate pass produced
// no `matches.expenseLabel` — because it timed out, errored, or was skipped —
// so the AddExpense form still opens with a name instead of an empty field.
//
// Everything here is voting over the room's own history: the label the user
// already uses for this store, a label that reads like the store name, and
// labels attached to receipts whose items look like the scanned ones.

import { nameSimilarity, type ExpenseLite } from './matching.ts'

/** Store name vs. an existing label ("Кобринское ЖКХ" → "ЖКХ"). */
const STORE_NAME_SIM_MIN = 0.4
/** Scanned item vs. an item on a past receipt. */
const ITEM_SIM_MIN = 0.55
/** Past labels count for more when the item match is strong. */
const ITEM_SIGNAL_WEIGHT = 1.5
/** A previous expense at the same store is the strongest single signal. */
const SAME_STORE_WEIGHT = 2

export interface LabelHistoryContext {
  expenses: ExpenseLite[]
  receipts: Array<{ id: string; expense_id: string }>
  receiptItems: Array<{ receipt_id: string; name?: string | null }>
}

export interface LabelSuggestion {
  name?: string
  categoryId?: string
}

/** Older history still votes, just more quietly. */
function recency(date: string): number {
  const t = Date.parse(date)
  if (Number.isNaN(t)) return 0.5
  const days = (Date.now() - t) / 86_400_000
  if (days <= 180) return 1
  if (days <= 540) return 0.75
  return 0.5
}

/**
 * Category the user most recently put on an expense carrying this label.
 * Used both to complete a model-supplied label and a fallback one.
 */
export function categoryIdForLabel(label: string, expenses: ExpenseLite[]): string | undefined {
  const target = label.trim().toLowerCase()
  if (!target) return undefined
  let best: ExpenseLite | null = null
  for (const e of expenses) {
    if (!e.category_id) continue
    if ((e.name ?? '').trim().toLowerCase() !== target) continue
    if (!best || e.date.localeCompare(best.date) > 0) best = e
  }
  return best?.category_id ?? undefined
}

export function suggestLabelFromHistory(
  input: { storeName?: string | null; items: Array<{ name: string }> },
  matchedStoreId: string | null,
  ctx: LabelHistoryContext,
): LabelSuggestion {
  const named = ctx.expenses.filter((e) => (e.name ?? '').trim().length > 0)
  if (!named.length) return {}

  const votes = new Map<string, number>()
  const add = (name: string, weight: number) => {
    const key = name.trim()
    if (!key || weight <= 0) return
    votes.set(key, (votes.get(key) ?? 0) + weight)
  }

  // Signal 1 — what this store's expenses are usually called.
  if (matchedStoreId) {
    for (const e of named) {
      if (e.store_id !== matchedStoreId) continue
      add(e.name as string, SAME_STORE_WEIGHT * recency(e.date))
    }
  }

  // Signal 2 — the store name itself resembles a label already in use.
  if (input.storeName) {
    for (const e of named) {
      const sim = nameSimilarity(input.storeName, e.name as string)
      if (sim < STORE_NAME_SIM_MIN) continue
      add(e.name as string, sim * recency(e.date))
    }
  }

  // Signal 3 — the scanned items match items from a past receipt; borrow the
  // label of the expense that receipt belongs to.
  if (input.items.length && ctx.receiptItems.length) {
    const expenseIdByReceipt = new Map<string, string>()
    for (const r of ctx.receipts) expenseIdByReceipt.set(r.id, r.expense_id)
    const expenseById = new Map<string, ExpenseLite>()
    for (const e of named) expenseById.set(e.id, e)

    for (const item of input.items) {
      let best: { receiptId: string; sim: number } | null = null
      for (const ri of ctx.receiptItems) {
        if (!ri.name) continue
        const sim = nameSimilarity(item.name, ri.name)
        if (sim < ITEM_SIM_MIN) continue
        if (!best || sim > best.sim) best = { receiptId: ri.receipt_id, sim }
      }
      if (!best) continue
      const expenseId = expenseIdByReceipt.get(best.receiptId)
      const expense = expenseId ? expenseById.get(expenseId) : undefined
      if (!expense) continue
      add(expense.name as string, best.sim * ITEM_SIGNAL_WEIGHT * recency(expense.date))
    }
  }

  let top: { name: string; weight: number } | null = null
  for (const [name, weight] of votes) {
    if (!top || weight > top.weight) top = { name, weight }
  }
  if (!top) return {}

  return { name: top.name, categoryId: categoryIdForLabel(top.name, ctx.expenses) }
}
