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

/** Distinct participant names used across a split group's expenses. */
export function collectGroupParticipantNames(
  groupId: string,
  expenses: Array<{ id: string; splitGroupId?: string }>,
  participants: Array<{ expenseId: string; name: string }>,
): string[] {
  const groupExpenseIds = new Set(
    expenses.filter((e) => e.splitGroupId === groupId).map((e) => e.id),
  )
  const names = new Set<string>()
  for (const p of participants) {
    if (groupExpenseIds.has(p.expenseId)) names.add(p.name)
  }
  return Array.from(names)
}

/**
 * Merge a split group's known members into the current participant list:
 * existing rows are kept untouched, the payer is seeded first when the list
 * is empty, and missing group members are appended as equal-split rows.
 * Returns the original array when there is nothing to add.
 */
export function mergeGroupParticipants<T extends ParticipantInput>(
  current: T[],
  payerName: string,
  groupNames: string[],
): Array<T | ParticipantInput> {
  if (groupNames.length === 0) return current

  const seen = new Set(
    current.map((p) => p.name.trim().toLowerCase()).filter(Boolean),
  )
  const added: ParticipantInput[] = []

  if (current.length === 0) {
    const payer = payerName.trim() || 'Плательщик'
    seen.add(payer.toLowerCase())
    added.push({ id: crypto.randomUUID(), name: payer, shareMode: 'equal' })
  }

  for (const raw of groupNames) {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    added.push({ id: crypto.randomUUID(), name, shareMode: 'equal' })
  }

  return added.length > 0 ? [...current, ...added] : current
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
  /** Display label, used by the per-person breakdown. */
  name?: string
  /** ISO date, used to order the per-person breakdown. */
  date?: string
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

/**
 * How much of an expense actually came out of the room's own pocket — the
 * figure the analytics screens total instead of the bill the payer fronted.
 *
 * A personal (unsplit) expense counts in full: nobody owes anything back. A
 * split expense counts only the money its **room-member** participants have
 * really handed over (`settledAmount`); shares of people outside the room, and
 * shares nobody has repaid yet, are somebody else's money and stay out of the
 * statistics until they are marked as paid. The payer's own fronting is never
 * counted on its own — it enters through their participant row like everyone
 * else's, so the payer's share shows up once they mark it as given.
 *
 * Every participant is capped at their own share, so an overpayment recorded by
 * {@link allocateSettlement} can never push an expense above its bill.
 *
 * Returns the amount in the expense's own currency.
 */
export function roomSettledAmount(
  amount: number,
  participants: ParticipantInput[],
  itemTotals: Map<string, number>,
  isRoomMember: (name: string) => boolean,
): number {
  if (participants.length === 0) return amount

  const { shares } = computeShares(amount, participants, itemTotals)
  let cents = 0
  for (const p of participants) {
    if (!isRoomMember(p.name)) continue
    const settled = toCents(p.settledAmount ?? 0)
    const share = toCents(shares.get(p.id) ?? 0)
    cents += Math.max(0, Math.min(settled, share))
  }
  return fromCents(cents)
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
 * Aggregate a set of expenses (e.g. one split group) into per-person balances
 * and the minimal set of transfers that settles everyone up. All amounts are
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

/** One participant row of a person inside a single expense. */
export interface PersonExpenseParticipantRow {
  participantId: string
  /** Owed share, in the expense's own currency. */
  shareNative: number
  /** Already repaid toward this expense, in the expense's own currency. */
  settledNative: number
}

/**
 * How one expense affects one person: what they fronted, what they consumed,
 * what has already been repaid, and what is still open — the per-expense
 * detail behind a row of {@link PersonBalance}.
 *
 * `paid`/`share`/`settled`/`received`/`net` are in the base currency (BYN) so
 * they add up across a group; the `*Native` fields stay in the expense's own
 * currency because that is what `participant.settledAmount` stores.
 */
export interface PersonExpenseEntry {
  expenseId: string
  expenseName: string
  date?: string
  currency: string
  /** Full bill, in the expense's own currency. */
  amountNative: number
  payerName: string
  /** True when this person fronted the whole bill. */
  isPayer: boolean
  /** The person's participant rows in this expense (empty for a payer who did not consume). */
  participantRows: PersonExpenseParticipantRow[]
  /** Fronted to the store: the full bill for the payer, 0 otherwise. */
  paid: number
  /** The person's own share of this expense. */
  share: number
  /** Already repaid by this person toward this expense. */
  settled: number
  /** Repayments this person received as the payer of this expense. */
  received: number
  /** paid − share + settled − received: this expense's contribution to the person's balance. */
  net: number
  /** Still owed to the payer for this expense (0 for the payer), base currency. */
  remaining: number
  /** Same as `remaining`, in the expense's own currency. */
  remainingNative: number
  /** True when a currency conversion was skipped for lack of a rate. */
  conversionGap: boolean
}

/**
 * Break a settlement down per person and per expense.
 *
 * Uses exactly the same inputs and share math as
 * {@link computeCategorySettlement}, so for every person the `net` of their
 * entries sums to that person's balance before group-level repayments.
 * Entries are ordered newest first.
 */
export function computePersonExpenseBreakdown(
  expenses: ExpenseInput[],
  participantsByExpenseId: Map<string, ParticipantInput[]>,
  itemTotalsByExpenseId: Map<string, Map<string, number>>,
  rates: CurrencyRateDocument[],
): Map<string, PersonExpenseEntry[]> {
  const rateMap = buildLatestRateMap(rates)
  const byPerson = new Map<string, PersonExpenseEntry[]>()

  for (const expense of expenses) {
    const payer = expense.creatorName?.trim()
    const participants = participantsByExpenseId.get(expense.id) ?? []
    // Mirrors computeCategorySettlement: nothing to attribute without a payer.
    if (!payer || participants.length === 0) continue

    let conversionGap = false
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

    const settledTotalNative = participants.reduce((sum, p) => sum + (p.settledAmount ?? 0), 0)

    // Everyone this expense touches: the payer plus each participant.
    const names = new Set<string>([payer, ...participants.map((p) => p.name)])

    for (const name of names) {
      const isPayer = name === payer
      const rows = participants.filter((p) => p.name === name)

      const shareNative = rows.reduce((sum, p) => sum + (shares.get(p.id) ?? 0), 0)
      const settledNative = rows.reduce((sum, p) => sum + (p.settledAmount ?? 0), 0)
      const remainingNative = isPayer ? 0 : Math.max(0, shareNative - settledNative)

      const paid = isPayer ? convert(expense.amount) : 0
      const share = convert(shareNative)
      const settled = convert(settledNative)
      const received = isPayer ? convert(settledTotalNative) : 0

      const entry: PersonExpenseEntry = {
        expenseId: expense.id,
        expenseName: expense.name?.trim() || 'Без названия',
        date: expense.date,
        currency: expense.currency,
        amountNative: expense.amount,
        payerName: payer,
        isPayer,
        participantRows: rows.map((p) => ({
          participantId: p.id,
          shareNative: round2(shares.get(p.id) ?? 0),
          settledNative: round2(p.settledAmount ?? 0),
        })),
        paid: round2(paid),
        share: round2(share),
        settled: round2(settled),
        received: round2(received),
        net: round2(paid - share + settled - received),
        remaining: round2(convert(remainingNative)),
        remainingNative: round2(remainingNative),
        conversionGap,
      }

      const list = byPerson.get(name) ?? []
      list.push(entry)
      byPerson.set(name, list)
    }
  }

  for (const list of byPerson.values()) {
    list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }
  return byPerson
}

/**
 * Spread a repayment across a person's participant rows inside one expense.
 *
 * Each row is filled up to its own share first (so a normal single-row split
 * just gets `settled + amount`); anything left over lands on the last row, so
 * an overpayment is never silently dropped. Returns `participantId -> new
 * total settledAmount`, containing only the rows that actually change.
 */
export function allocateSettlement(
  rows: PersonExpenseParticipantRow[],
  amount: number,
): Map<string, number> {
  const result = new Map<string, number>()
  if (rows.length === 0 || !Number.isFinite(amount) || amount <= 0) return result

  let leftCents = toCents(amount)
  const updated = rows.map((r) => ({ row: r, cents: toCents(r.settledNative) }))

  for (const u of updated) {
    if (leftCents <= 0) break
    const room = toCents(u.row.shareNative) - u.cents
    if (room <= 0) continue
    const take = Math.min(room, leftCents)
    u.cents += take
    leftCents -= take
  }

  // Overpayment (or fully settled rows): put the rest on the last row.
  if (leftCents !== 0) {
    const last = updated[updated.length - 1]
    last.cents = Math.max(0, last.cents + leftCents)
  }

  for (const u of updated) {
    const next = fromCents(u.cents)
    if (next !== u.row.settledNative) result.set(u.row.participantId, next)
  }
  return result
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
