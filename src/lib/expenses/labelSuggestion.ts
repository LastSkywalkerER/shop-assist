import { nameSimilarity } from '../ai/matching'

/**
 * Last-resort expense-label fallback, applied in the form itself.
 *
 * The scan pipeline already votes a label out of the room's history server-side
 * (`supabase/functions/_shared/labelSuggestion.ts`, which additionally weighs
 * past receipt items). This client copy covers what that can't: prefill
 * payloads produced before the server gained the fallback, and any scan whose
 * `matches` block still came back empty. Store signals only — the form has the
 * expense list in memory, not the receipt-item history.
 */

/** Store name vs. an existing label ("Кобринское ЖКХ" → "ЖКХ"). */
const STORE_NAME_SIM_MIN = 0.4
/** A previous expense at the same store is the strongest single signal. */
const SAME_STORE_WEIGHT = 2

export interface LabelExpenseLite {
  name?: string
  storeId?: string
  categoryId?: string
  date: string
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

/** Category the user most recently put on an expense carrying this label. */
export function categoryIdForLabel(label: string, expenses: LabelExpenseLite[]): string | undefined {
  const target = label.trim().toLowerCase()
  if (!target) return undefined
  let best: LabelExpenseLite | null = null
  for (const e of expenses) {
    if (!e.categoryId || !e.name) continue
    if (e.name.trim().toLowerCase() !== target) continue
    if (!best || e.date.localeCompare(best.date) > 0) best = e
  }
  return best?.categoryId
}

export function suggestLabelFromExpenses(
  input: { storeId?: string; storeName?: string },
  expenses: LabelExpenseLite[],
): LabelSuggestion {
  const named = expenses.filter((e) => (e.name ?? '').trim().length > 0)
  if (!named.length) return {}

  const votes = new Map<string, number>()
  const add = (name: string, weight: number) => {
    const key = name.trim()
    if (!key || weight <= 0) return
    votes.set(key, (votes.get(key) ?? 0) + weight)
  }

  // Signal 1 — what this store's expenses are usually called.
  if (input.storeId) {
    for (const e of named) {
      if (e.storeId !== input.storeId) continue
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

  let top: { name: string; weight: number } | null = null
  for (const [name, weight] of votes) {
    if (!top || weight > top.weight) top = { name, weight }
  }
  if (!top) return {}

  return { name: top.name, categoryId: categoryIdForLabel(top.name, expenses) }
}
