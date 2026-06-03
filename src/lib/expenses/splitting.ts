import type { CurrencyRateDocument, ExpenseShareMode } from '../../db/types'
import { BASE_CURRENCY, buildLatestRateMap, convertToBase } from '../currency/convert'

/** Minimal participant shape needed for the split math. */
export interface ParticipantInput {
  id: string
  name: string
  shareMode: ExpenseShareMode
  shareAmount?: number
  itemIds?: string[]
  settledAmount?: number
}

/** Line total for a receipt item — unit price × quantity. */
export function lineItemTotal(item: { amount: number; quantity?: number }): number {
  return (item.amount || 0) * (item.quantity ?? 1)
}

const toCents = (x: number): number => Math.round((x || 0) * 100)
const fromCents = (c: number): number => c / 100

export interface ShareResult {
  /** participantId -> share amount (in the expense's currency). */
  shares: Map<string, number>
  /** Sum of fixed `amount` + `items` shares. */
  assigned: number
  /** amount − assigned; this is what the equal split divides. */
  remainder: number
  /** Remainder left uncovered because there are no `equal` participants (> 0). */
  unassigned: number
  /** How much assigned shares exceed the expense amount (> 0). */
  overAssigned: number
}

/**
 * Compute each participant's owed share of an expense.
 *
 * `itemTotals` maps a receipt item id to its line total (in the expense
 * currency); used to resolve `items`-mode shares.
 */
export function computeShares(
  amount: number,
  participants: ParticipantInput[],
  itemTotals: Map<string, number> = new Map(),
): ShareResult {
  const amountCents = toCents(amount)
  const shares = new Map<string, number>()

  let assignedCents = 0
  const equalParticipants: ParticipantInput[] = []

  for (const p of participants) {
    if (p.shareMode === 'amount') {
      const cents = toCents(p.shareAmount ?? 0)
      assignedCents += cents
      shares.set(p.id, fromCents(cents))
    } else if (p.shareMode === 'items') {
      const total = (p.itemIds ?? []).reduce((sum, id) => sum + (itemTotals.get(id) ?? 0), 0)
      const cents = toCents(total)
      assignedCents += cents
      shares.set(p.id, fromCents(cents))
    } else {
      equalParticipants.push(p)
      shares.set(p.id, 0)
    }
  }

  const remainderCents = amountCents - assignedCents
  let unassignedCents = 0
  let overAssignedCents = 0

  if (remainderCents < 0) {
    overAssignedCents = -remainderCents
  } else if (equalParticipants.length === 0) {
    unassignedCents = remainderCents
  } else {
    const n = equalParticipants.length
    const base = Math.floor(remainderCents / n)
    let extra = remainderCents - base * n
    // Distribute the leftover cents deterministically to the first participants
    // so the shares sum exactly to the remainder.
    for (const p of equalParticipants) {
      const cents = base + (extra > 0 ? 1 : 0)
      if (extra > 0) extra -= 1
      shares.set(p.id, fromCents(cents))
    }
  }

  return {
    shares,
    assigned: fromCents(assignedCents),
    remainder: fromCents(remainderCents),
    unassigned: fromCents(unassignedCents),
    overAssigned: fromCents(overAssignedCents),
  }
}

export interface ExpenseInput {
  id: string
  amount: number
  currency: string
  /** Main payer who fronted the whole bill. */
  creatorName?: string
  /** The expense "type" (food, transport, …). Orthogonal to whether it is split. */
  categoryId?: string
}

/**
 * Per-expense view of "what did this expense cost *the creator*", plus the two
 * orthogonal dimensions a personal-stats screen groups by: the **type**
 * (`categoryId`) and the **group** (`isSplit`). "Раздельный" is a separate
 * flag, not a type — a split expense keeps its category and is still summed
 * by category, just counted at the creator's own share.
 */
export interface ExpenseSplitInfo {
  expenseId: string
  /** Type dimension — unchanged from the expense. */
  categoryId?: string
  /** Group dimension — true when the expense has at least one participant row. */
  isSplit: boolean
  creatorName: string
  /** Creator's own share, in the expense's currency. */
  creatorShareNative: number
  /** Creator's own share, converted to the base currency (BYN); null if no rate. */
  creatorShareBase: number | null
  /** Full bill, converted to the base currency (BYN); null if no rate. */
  fullAmountBase: number | null
  /** True when a needed conversion was skipped because the currency had no rate. */
  conversionGap: boolean
}

/**
 * Assemble `expenseId -> (receiptItemId -> line total)` from receipts and their
 * items, mirroring the logic the settlement view uses. Shared so the same
 * `items`-mode resolution feeds both the settlement and the split-info helpers.
 */
export function buildItemTotals(
  receipts: Array<{ id: string; expenseId: string }>,
  receiptItems: Array<{ id: string; receiptId: string; amount: number; quantity?: number }>,
): Map<string, Map<string, number>> {
  const itemsByReceipt = new Map<string, typeof receiptItems>()
  for (const it of receiptItems) {
    const list = itemsByReceipt.get(it.receiptId) ?? []
    list.push(it)
    itemsByReceipt.set(it.receiptId, list)
  }
  const totalsByExpenseId = new Map<string, Map<string, number>>()
  for (const r of receipts) {
    const totals = totalsByExpenseId.get(r.expenseId) ?? new Map<string, number>()
    for (const it of itemsByReceipt.get(r.id) ?? []) {
      totals.set(it.id, lineItemTotal(it))
    }
    totalsByExpenseId.set(r.expenseId, totals)
  }
  return totalsByExpenseId
}

function splitInfoWithRateMap(
  expense: ExpenseInput,
  participants: ParticipantInput[],
  itemTotals: Map<string, number>,
  rateMap: Map<string, CurrencyRateDocument>,
): ExpenseSplitInfo {
  const creatorName = expense.creatorName?.trim() ?? ''
  const isSplit = participants.length > 0
  const convert = (x: number): number | null => convertToBase(x, expense.currency, rateMap)

  const fullAmountBase = convert(expense.amount)

  let creatorShareNative: number
  if (!isSplit) {
    // Personal expense: the whole bill is the creator's own cost.
    creatorShareNative = expense.amount
  } else {
    const { shares } = computeShares(expense.amount, participants, itemTotals)
    // The creator's share is the share of the participant row that carries the
    // creator's name. If the creator only fronted money but did not consume
    // (no matching participant), their own cost is 0 — matching settlement net.
    creatorShareNative = creatorName
      ? participants
          .filter((p) => p.name.trim().toLowerCase() === creatorName.toLowerCase())
          .reduce((sum, p) => sum + (shares.get(p.id) ?? 0), 0)
      : 0
  }

  // A zero share needs no conversion and never counts as a gap.
  const creatorShareBase = creatorShareNative === 0 ? 0 : convert(creatorShareNative)
  const conversionGap = fullAmountBase === null || creatorShareBase === null

  return {
    expenseId: expense.id,
    categoryId: expense.categoryId,
    isSplit,
    creatorName,
    creatorShareNative: round2(creatorShareNative),
    creatorShareBase: creatorShareBase === null ? null : round2(creatorShareBase),
    fullAmountBase: fullAmountBase === null ? null : round2(fullAmountBase),
    conversionGap,
  }
}

/**
 * Compute the creator's own cost of a single expense (see {@link ExpenseSplitInfo}).
 */
export function creatorSplitInfo(
  expense: ExpenseInput,
  participants: ParticipantInput[],
  itemTotals: Map<string, number>,
  rates: CurrencyRateDocument[],
): ExpenseSplitInfo {
  return splitInfoWithRateMap(expense, participants, itemTotals, buildLatestRateMap(rates))
}

/**
 * Annotate a set of expenses with their split info, keyed by expense id. Each
 * entry keeps its `categoryId` (type) alongside the derived `isSplit` (group),
 * so a stats consumer can total **by category** while filtering split vs not —
 * without ever lumping all split expenses into a single bucket.
 */
export function annotateExpensesWithSplit(
  expenses: ExpenseInput[],
  participantsByExpenseId: Map<string, ParticipantInput[]>,
  itemTotalsByExpenseId: Map<string, Map<string, number>>,
  rates: CurrencyRateDocument[],
): Map<string, ExpenseSplitInfo> {
  const rateMap = buildLatestRateMap(rates)
  const result = new Map<string, ExpenseSplitInfo>()
  for (const expense of expenses) {
    result.set(
      expense.id,
      splitInfoWithRateMap(
        expense,
        participantsByExpenseId.get(expense.id) ?? [],
        itemTotalsByExpenseId.get(expense.id) ?? new Map(),
        rateMap,
      ),
    )
  }
  return result
}

export interface PersonBalance {
  name: string
  /** Total fronted to stores (as the payer), in base currency. */
  paid: number
  /** Total owed share (consumption), in base currency. */
  share: number
  /** Total already paid back via per-expense settledAmount, in base currency. */
  settled: number
  /** Sum of category-level repayments this person made, in base currency. */
  categoryPaid: number
  /** Remaining balance after all settlements; > 0 owed, < 0 owes. */
  net: number
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

/** A recorded category-level repayment (debtor → creditor), in base currency. */
export interface SettlementPayment {
  from: string
  to: string
  amount: number
}

export interface SettlementResult {
  perPerson: PersonBalance[]
  transfers: Transfer[]
  /** True if some expense currency had no rate and was skipped from conversion. */
  conversionGap: boolean
  baseCurrency: string
}

interface Acc {
  paid: number
  share: number
  settledPaid: number
  settledReceived: number
}

/**
 * Aggregate a set of expenses (e.g. one category) into per-person balances and
 * the minimal set of transfers that settles everyone up. All amounts are
 * converted to the base currency (BYN) using the latest NBRB rates.
 */
export function computeCategorySettlement(
  expenses: ExpenseInput[],
  participantsByExpenseId: Map<string, ParticipantInput[]>,
  itemTotalsByExpenseId: Map<string, Map<string, number>>,
  rates: CurrencyRateDocument[],
  settlements: SettlementPayment[] = [],
): SettlementResult {
  const rateMap = buildLatestRateMap(rates)
  const acc = new Map<string, Acc>()
  let conversionGap = false

  const ensure = (name: string): Acc => {
    let a = acc.get(name)
    if (!a) {
      a = { paid: 0, share: 0, settledPaid: 0, settledReceived: 0 }
      acc.set(name, a)
    }
    return a
  }

  for (const expense of expenses) {
    const payer = expense.creatorName?.trim()
    const participants = participantsByExpenseId.get(expense.id) ?? []
    // Nothing to settle without a payer to attribute the bill to.
    if (!payer || participants.length === 0) continue

    const convert = (x: number): number => {
      const v = convertToBase(x, expense.currency, rateMap)
      if (v === null) {
        conversionGap = true
        return 0
      }
      return v
    }

    const { shares } = computeShares(
      expense.amount,
      participants,
      itemTotalsByExpenseId.get(expense.id) ?? new Map(),
    )

    ensure(payer).paid += convert(expense.amount)

    for (const p of participants) {
      const share = shares.get(p.id) ?? 0
      const settled = p.settledAmount ?? 0
      const pa = ensure(p.name)
      pa.share += convert(share)
      pa.settledPaid += convert(settled)
      ensure(payer).settledReceived += convert(settled)
    }
  }

  const perPerson: PersonBalance[] = []
  for (const [name, a] of acc) {
    perPerson.push({
      name,
      paid: round2(a.paid),
      share: round2(a.share),
      settled: round2(a.settledPaid),
      categoryPaid: 0,
      net: a.paid - a.share + a.settledPaid - a.settledReceived,
    })
  }

  // Apply recorded category-level repayments: the payer's debt shrinks, the
  // recipient's credit shrinks. People may appear here even if they were only
  // creditors/debtors via these payments.
  const byName = new Map(perPerson.map((p) => [p.name, p]))
  const ensurePerson = (name: string): PersonBalance => {
    let p = byName.get(name)
    if (!p) {
      p = { name, paid: 0, share: 0, settled: 0, categoryPaid: 0, net: 0 }
      byName.set(name, p)
      perPerson.push(p)
    }
    return p
  }
  for (const s of settlements) {
    const from = ensurePerson(s.from)
    const to = ensurePerson(s.to)
    from.net += s.amount
    from.categoryPaid += s.amount
    to.net -= s.amount
  }

  for (const p of perPerson) {
    p.net = round2(p.net)
    p.categoryPaid = round2(p.categoryPaid)
  }
  perPerson.sort((x, y) => y.net - x.net)

  return {
    perPerson,
    transfers: minimizeTransfers(perPerson),
    conversionGap,
    baseCurrency: BASE_CURRENCY,
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/**
 * Greedy minimal-transfer settlement: repeatedly match the largest debtor with
 * the largest creditor. Produces at most (n − 1) transfers.
 */
export function minimizeTransfers(balances: Array<{ name: string; net: number }>): Transfer[] {
  const creditors: Array<{ name: string; cents: number }> = []
  const debtors: Array<{ name: string; cents: number }> = []

  for (const b of balances) {
    const cents = Math.round(b.net * 100)
    if (cents > 0) creditors.push({ name: b.name, cents })
    else if (cents < 0) debtors.push({ name: b.name, cents: -cents })
  }

  creditors.sort((a, b) => b.cents - a.cents)
  debtors.sort((a, b) => b.cents - a.cents)

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.cents, creditor.cents)
    if (amount > 0) {
      transfers.push({ from: debtor.name, to: creditor.name, amount: amount / 100 })
      debtor.cents -= amount
      creditor.cents -= amount
    }
    if (debtor.cents === 0) i += 1
    if (creditor.cents === 0) j += 1
  }

  return transfers
}
