// Reconcile parsed expense-list rows against the user's existing expenses.
// A row matches an expense when the currency is equal AND the amount is an
// exact match or within ±1 currency unit. When several expenses qualify, the
// closest by date wins (then the smallest amount delta). Date never excludes a
// candidate — it only ranks. Pure functions, no I/O.

import type { ExpenseDocument } from '../../db/types'
import type { ParsedExpenseRow } from './parseExpenseList'

/** Max absolute amount difference (in currency units) still counted as a match. */
export const AMOUNT_TOLERANCE = 1

export interface RowMatch {
  /** Best existing expense this row maps to, or null when nothing qualifies. */
  match: ExpenseDocument | null
  /** Other qualifying expenses, best-first, excluding `match`. */
  alternates: ExpenseDocument[]
}

const MS_PER_DAY = 86_400_000

/** Absolute day distance between a parsed row date and an expense date, or null. */
function dayDelta(rowDate: string | null, expDate: string): number | null {
  if (!rowDate) return null
  const a = new Date(rowDate).getTime()
  const b = new Date(expDate).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return Math.abs(a - b) / MS_PER_DAY
}

/** Effective currency for a row: its own, else the list default. */
export function effectiveCurrency(row: ParsedExpenseRow, listCurrency: string): string {
  return row.currency || listCurrency
}

export function matchParsedRow(
  row: ParsedExpenseRow,
  listCurrency: string,
  expenses: ExpenseDocument[],
): RowMatch {
  const cur = effectiveCurrency(row, listCurrency)
  const candidates = expenses
    .map((exp) => ({
      exp,
      amountDelta: Math.abs(exp.amount - row.amount),
      dayDelta: dayDelta(row.date, exp.date),
    }))
    .filter((c) => c.exp.currency === cur && c.amountDelta <= AMOUNT_TOLERANCE)
    .sort((a, b) => {
      const ad = a.dayDelta ?? Number.POSITIVE_INFINITY
      const bd = b.dayDelta ?? Number.POSITIVE_INFINITY
      if (ad !== bd) return ad - bd
      return a.amountDelta - b.amountDelta
    })

  return {
    match: candidates[0]?.exp ?? null,
    alternates: candidates.slice(1).map((c) => c.exp),
  }
}

export function matchParsedRows(
  rows: ParsedExpenseRow[],
  listCurrency: string,
  expenses: ExpenseDocument[],
): RowMatch[] {
  return rows.map((row) => matchParsedRow(row, listCurrency, expenses))
}
