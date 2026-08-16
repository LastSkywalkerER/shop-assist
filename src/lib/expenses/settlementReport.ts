/**
 * Renders a split-group settlement into a self-contained, print-ready HTML
 * document. The result is fed to {@link printHtmlDocument}, where the browser
 * turns it into a PDF.
 *
 * The document is deliberately light-themed and paper-sized: it is meant to be
 * saved and shared, not shown inside the app.
 */
import type { PersonBalance, PersonExpenseEntry, Transfer } from './splitting'

export interface SettlementReportPayment {
  from: string
  to: string
  amount: number
}

export interface SettlementReportInput {
  /** Split group name, shown as the report subtitle. */
  groupName: string
  /** Currency every figure in the report is expressed in. */
  baseCurrency: string
  perPerson: PersonBalance[]
  transfers: Transfer[]
  /** Person name -> their per-expense entries, as shown in the expanded rows. */
  breakdown: Map<string, PersonExpenseEntry[]>
  /** Group-level repayments recorded on the settlement screen. */
  payments: SettlementReportPayment[]
  /** True when some currency had no rate and was skipped from the conversion. */
  conversionGap: boolean
  /** Timestamp printed in the header; injected so the output stays testable. */
  generatedAt: Date
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const DATE_TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const FILE_DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d)
}

/**
 * Document title, which browsers also use as the default PDF file name.
 * Slashes would be read as path separators, so the date is dot-separated.
 */
export function settlementReportTitle(groupName: string, generatedAt: Date): string {
  const date = FILE_DATE_FMT.format(generatedAt).replace(/\//g, '.')
  const name = groupName.trim() || 'Без группы'
  return `Сводка по расходам — ${name} — ${date}`
}

/** One deduplicated expense of the group, rebuilt from the per-person entries. */
interface ReportExpense {
  id: string
  name: string
  date?: string
  amountNative: number
  currency: string
  payerName: string
}

function collectExpenses(breakdown: Map<string, PersonExpenseEntry[]>): ReportExpense[] {
  const byId = new Map<string, ReportExpense>()
  for (const entries of breakdown.values()) {
    for (const e of entries) {
      if (byId.has(e.expenseId)) continue
      byId.set(e.expenseId, {
        id: e.expenseId,
        name: e.expenseName,
        date: e.date,
        amountNative: e.amountNative,
        currency: e.currency,
        payerName: e.payerName,
      })
    }
  }
  return [...byId.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function buildSettlementReportHtml(input: SettlementReportInput): string {
  const { baseCurrency: cur } = input
  const money = (n: number) => `${n.toFixed(2)}&nbsp;${escapeHtml(cur)}`
  const signedMoney = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}&nbsp;${escapeHtml(cur)}`
  const netClass = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero')

  const expenses = collectExpenses(input.breakdown)
  const totalPaid = input.perPerson.reduce((sum, p) => sum + p.paid, 0)
  const totalSettled = input.perPerson.reduce((sum, p) => sum + p.settled, 0)
  const openDebt = input.transfers.reduce((sum, t) => sum + t.amount, 0)

  const title = settlementReportTitle(input.groupName, input.generatedAt)

  const statsHtml = [
    { label: 'Всего расходов', value: String(expenses.length) },
    { label: 'Общая сумма', value: money(totalPaid) },
    { label: 'Участников', value: String(input.perPerson.length) },
    { label: 'Осталось раздать', value: money(openDebt) },
  ]
    .map(
      (s) => `<div class="stat">
        <div class="stat-label">${escapeHtml(s.label)}</div>
        <div class="stat-value">${s.value}</div>
      </div>`,
    )
    .join('')

  const balancesHtml = input.perPerson
    .map(
      (p) => `<tr>
        <td class="name">${escapeHtml(p.name)}</td>
        <td class="num">${money(p.paid)}</td>
        <td class="num">${money(p.share)}</td>
        <td class="num">${money(p.settled)}</td>
        <td class="num strong ${netClass(p.net)}">${signedMoney(p.net)}</td>
      </tr>`,
    )
    .join('')

  const transfersHtml = input.transfers.length
    ? `<table class="table">
        <thead><tr><th>Кто отдаёт</th><th>Кому</th><th class="num">Сумма</th></tr></thead>
        <tbody>${input.transfers
          .map(
            (t) => `<tr>
              <td class="name">${escapeHtml(t.from)}</td>
              <td class="name">${escapeHtml(t.to)}</td>
              <td class="num strong">${money(t.amount)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>`
    : `<p class="empty">Все долги погашены.</p>`

  const expensesHtml = expenses.length
    ? `<table class="table">
        <thead><tr><th>Дата</th><th>Расход</th><th class="num">Сумма</th><th>Платил</th></tr></thead>
        <tbody>${expenses
          .map(
            (e) => `<tr>
              <td class="dim nowrap">${escapeHtml(formatDate(e.date))}</td>
              <td class="name">${escapeHtml(e.name)}</td>
              <td class="num">${e.amountNative.toFixed(2)}&nbsp;${escapeHtml(e.currency)}</td>
              <td class="dim">${escapeHtml(e.payerName)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>`
    : `<p class="empty">В группе нет разделённых расходов.</p>`

  const paymentsHtml = input.payments.length
    ? `<section class="section">
        <h2>Записанные оплаты</h2>
        <table class="table">
          <thead><tr><th>От кого</th><th>Кому</th><th class="num">Сумма</th></tr></thead>
          <tbody>${input.payments
            .map(
              (s) => `<tr>
                <td class="name">${escapeHtml(s.from)}</td>
                <td class="name">${escapeHtml(s.to)}</td>
                <td class="num">${money(s.amount)}</td>
              </tr>`,
            )
            .join('')}</tbody>
        </table>
      </section>`
    : ''

  const detailsHtml = input.perPerson
    .map((person) => {
      const entries = input.breakdown.get(person.name) ?? []
      if (entries.length === 0) return ''
      const rows = entries
        .map(
          (e) => `<tr>
            <td class="dim nowrap">${escapeHtml(formatDate(e.date))}</td>
            <td class="name">${escapeHtml(e.expenseName)}${
              e.isPayer ? ' <span class="badge">платил</span>' : ''
            }</td>
            <td class="num">${money(e.share)}</td>
            <td class="num">${e.isPayer ? money(e.received) : money(e.settled)}</td>
            <td class="num">${e.isPayer ? '—' : money(e.remaining)}</td>
            <td class="num strong ${netClass(e.net)}">${signedMoney(e.net)}</td>
          </tr>`,
        )
        .join('')
      return `<div class="person">
        <div class="person-head">
          <span class="person-name">${escapeHtml(person.name)}</span>
          <span class="person-net ${netClass(person.net)}">${signedMoney(person.net)}</span>
        </div>
        <table class="table compact">
          <thead><tr>
            <th>Дата</th><th>Расход</th>
            <th class="num">Доля</th>
            <th class="num">Отдал / вернули</th>
            <th class="num">Осталось</th>
            <th class="num">Итог</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    })
    .join('')

  const warningHtml = input.conversionGap
    ? `<p class="warning">Для некоторых валют не нашлось курса — эти суммы не учтены в пересчёте в ${escapeHtml(cur)}.</p>`
    : ''

  // The doctype matters: without it the print frame renders in quirks mode.
  return `<!doctype html>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  :root {
    --ink: #16181d;
    --muted: #6b7280;
    --line: #e3e6ec;
    --accent: #2f6fed;
    --pos: #12813f;
    --neg: #c02626;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    padding: 24px 20px 32px;
    background: #fff;
    color: var(--ink);
    font: 400 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .sheet { max-width: 760px; margin: 0 auto; }
  header { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.2px; }
  .subtitle { margin: 4px 0 0; font-size: 14px; font-weight: 600; color: var(--accent); }
  .generated { margin: 6px 0 0; font-size: 11px; color: var(--muted); }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .stat { flex: 1 1 120px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); }
  .stat-value { font-size: 15px; font-weight: 700; margin-top: 2px; white-space: nowrap; }
  .section { margin-bottom: 20px; break-inside: avoid; page-break-inside: avoid; }
  h2 {
    margin: 0 0 8px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.7px; color: var(--muted);
  }
  .table { width: 100%; border-collapse: collapse; }
  .table th {
    text-align: left; font-size: 10px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.4px;
    padding: 0 8px 5px; border-bottom: 1px solid var(--line);
  }
  .table td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .table tbody tr:last-child td { border-bottom: none; }
  .table.compact td, .table.compact th { padding-top: 4px; padding-bottom: 4px; }
  .table th.num, .table td.num { text-align: right; white-space: nowrap; }
  .name { font-weight: 600; }
  .dim { color: var(--muted); }
  .nowrap { white-space: nowrap; }
  .strong { font-weight: 700; }
  .pos { color: var(--pos); }
  .neg { color: var(--neg); }
  .zero { color: var(--muted); }
  .legend { margin: 6px 0 0; font-size: 10px; color: var(--muted); }
  .empty { margin: 0; font-size: 12px; color: var(--muted); }
  .warning {
    margin: 0 0 16px; padding: 8px 10px; font-size: 11px;
    border: 1px solid #f0d48a; background: #fdf6e3; border-radius: 8px; color: #7a5a12;
  }
  .person { margin-bottom: 14px; break-inside: avoid; page-break-inside: avoid; }
  .person-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    padding-bottom: 4px; border-bottom: 2px solid var(--line);
  }
  .person-name { font-size: 13px; font-weight: 700; }
  .person-net { font-size: 13px; font-weight: 700; }
  .badge {
    display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 20px;
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
    background: #eef3fe; color: var(--accent); vertical-align: 1px;
  }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 10px; color: var(--muted); }
</style>
<div class="sheet">
  <header>
    <h1>Сводка по расходам</h1>
    <p class="subtitle">${escapeHtml(input.groupName.trim() || 'Без группы')}</p>
    <p class="generated">Сформировано ${escapeHtml(DATE_TIME_FMT.format(input.generatedAt))} · все суммы в ${escapeHtml(cur)}</p>
  </header>

  ${warningHtml}

  <div class="stats">${statsHtml}</div>

  <section class="section">
    <h2>Баланс участников</h2>
    <table class="table">
      <thead><tr>
        <th>Участник</th>
        <th class="num">Потратил</th>
        <th class="num">Доля</th>
        <th class="num">Отдал</th>
        <th class="num">Итог</th>
      </tr></thead>
      <tbody>${balancesHtml}</tbody>
    </table>
    <p class="legend">Плюс — сколько человеку должны, минус — сколько должен он. Всего погашено: ${money(totalSettled)}.</p>
  </section>

  <section class="section">
    <h2>Кто кому переводит</h2>
    ${transfersHtml}
  </section>

  ${paymentsHtml}

  <section class="section">
    <h2>Расходы группы</h2>
    ${expensesHtml}
  </section>

  ${detailsHtml ? `<section class="section"><h2>Детализация по участникам</h2>${detailsHtml}</section>` : ''}

  <footer>Shop Assist · ${escapeHtml(title)}</footer>
</div>`
}
