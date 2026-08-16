/**
 * Turns a split-group settlement into a pdfmake document definition — the
 * "Сводка по расходам" screen as a shareable A4 report.
 *
 * Pure and synchronous: it only describes the document, so it can be unit
 * tested without loading pdfmake. Rendering happens in `lib/pdf/generatePdf`.
 */
import type {
  Content,
  ContentTable,
  CustomTableLayout,
  TDocumentDefinitions,
  TableCell,
} from 'pdfmake/interfaces'
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

const INK = '#16181d'
const MUTED = '#6b7280'
const LINE = '#e3e6ec'
const ACCENT = '#2f6fed'
const POSITIVE = '#12813f'
const NEGATIVE = '#c02626'

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

const FILE_TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Characters no common filesystem accepts inside a file name. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d)
}

/**
 * Report name, used both as the PDF's title and as the download file name.
 *
 * Carries the group, the date and the time so two exports of the same group
 * never collide in the downloads folder.
 */
export function settlementReportTitle(groupName: string, generatedAt: Date): string {
  const name = groupName.replace(ILLEGAL_FILENAME_CHARS, ' ').trim() || 'Без группы'
  const date = DATE_FMT.format(generatedAt)
  const time = FILE_TIME_FMT.format(generatedAt).replace(':', '-')
  return `Сводка расходов — ${name} — ${date} ${time}`
}

/** Download file name for the report. */
export function settlementReportFileName(groupName: string, generatedAt: Date): string {
  return `${settlementReportTitle(groupName, generatedAt)}.pdf`
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

/** Horizontal rules only: a header underline plus hairlines between rows. */
const dataTableLayout: CustomTableLayout = {
  hLineWidth: (rowIndex, node) => {
    if (rowIndex === 0 || rowIndex === node.table.body.length) return 0
    return rowIndex === 1 ? 0.8 : 0.4
  },
  vLineWidth: () => 0,
  hLineColor: () => LINE,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 4,
  paddingBottom: () => 4,
}

/** Boxed cells for the summary tiles at the top of the report. */
const statsTableLayout: CustomTableLayout = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  paddingLeft: () => 7,
  paddingRight: () => 7,
  paddingTop: () => 6,
  paddingBottom: () => 6,
}

function header(text: string): TableCell {
  return { text, style: 'th' }
}

function dataTable(widths: (string | number)[], head: string[], body: TableCell[][]): ContentTable {
  return {
    table: {
      headerRows: 1,
      widths,
      body: [head.map(header), ...body],
    },
    layout: dataTableLayout,
  }
}

export function buildSettlementPdf(input: SettlementReportInput): TDocumentDefinitions {
  const cur = input.baseCurrency
  // A non-breaking space keeps the currency glued to its number.
  const money = (n: number) => `${n.toFixed(2)}\u00A0${cur}`
  const signedMoney = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`
  const netColor = (n: number) => (n > 0 ? POSITIVE : n < 0 ? NEGATIVE : MUTED)

  const expenses = collectExpenses(input.breakdown)
  const totalPaid = input.perPerson.reduce((sum, p) => sum + p.paid, 0)
  const totalSettled = input.perPerson.reduce((sum, p) => sum + p.settled, 0)
  const openDebt = input.transfers.reduce((sum, t) => sum + t.amount, 0)

  const title = settlementReportTitle(input.groupName, input.generatedAt)

  const stats: [string, string][] = [
    ['Всего расходов', String(expenses.length)],
    ['Общая сумма', money(totalPaid)],
    ['Участников', String(input.perPerson.length)],
    ['Осталось раздать', money(openDebt)],
  ]

  const content: Content[] = [
    { text: 'Сводка по расходам', style: 'title' },
    { text: input.groupName.trim() || 'Без группы', style: 'subtitle' },
    {
      text: `Сформировано ${DATE_TIME_FMT.format(input.generatedAt)} · все суммы в ${cur}`,
      style: 'generated',
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.4, lineColor: ACCENT }],
      margin: [0, 8, 0, 14],
    },
  ]

  if (input.conversionGap) {
    content.push({
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: `Для некоторых валют не нашлось курса — эти суммы не учтены в пересчёте в ${cur}.`,
              style: 'warning',
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.6,
        vLineWidth: () => 0.6,
        hLineColor: () => '#f0d48a',
        vLineColor: () => '#f0d48a',
        paddingLeft: () => 7,
        paddingRight: () => 7,
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
      margin: [0, 0, 0, 12],
    })
  }

  content.push({
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        stats.map(([label, value]) => ({
          stack: [
            { text: label.toUpperCase(), style: 'statLabel' },
            { text: value, style: 'statValue' },
          ],
        })),
      ],
    },
    layout: statsTableLayout,
    margin: [0, 0, 0, 16],
  })

  content.push(
    { text: 'Баланс участников', style: 'sectionHeader' },
    dataTable(
      ['*', 'auto', 'auto', 'auto', 'auto'],
      ['Участник', 'Потратил', 'Доля', 'Отдал', 'Итог'],
      input.perPerson.map((p) => [
        { text: p.name, style: 'name' },
        { text: money(p.paid), style: 'num' },
        { text: money(p.share), style: 'num' },
        { text: money(p.settled), style: 'num' },
        { text: signedMoney(p.net), style: 'num', bold: true, color: netColor(p.net) },
      ]),
    ),
    {
      text: `Плюс — сколько человеку должны, минус — сколько должен он. Всего погашено: ${money(totalSettled)}.`,
      style: 'legend',
    },
  )

  content.push({ text: 'Кто кому переводит', style: 'sectionHeader' })
  content.push(
    input.transfers.length
      ? dataTable(
          ['*', '*', 'auto'],
          ['Кто отдаёт', 'Кому', 'Сумма'],
          input.transfers.map((t) => [
            { text: t.from, style: 'name' },
            { text: t.to, style: 'name' },
            { text: money(t.amount), style: 'num', bold: true },
          ]),
        )
      : { text: 'Все долги погашены.', style: 'empty' },
  )

  if (input.payments.length) {
    content.push(
      { text: 'Записанные оплаты', style: 'sectionHeader' },
      dataTable(
        ['*', '*', 'auto'],
        ['От кого', 'Кому', 'Сумма'],
        input.payments.map((s) => [
          { text: s.from, style: 'name' },
          { text: s.to, style: 'name' },
          { text: money(s.amount), style: 'num' },
        ]),
      ),
    )
  }

  content.push({ text: 'Расходы группы', style: 'sectionHeader' })
  content.push(
    expenses.length
      ? dataTable(
          ['auto', '*', 'auto', 'auto'],
          ['Дата', 'Расход', 'Сумма', 'Платил'],
          expenses.map((e) => [
            { text: formatDate(e.date), style: 'dim' },
            { text: e.name, style: 'name' },
            { text: `${e.amountNative.toFixed(2)}\u00A0${e.currency}`, style: 'num' },
            { text: e.payerName, style: 'dim' },
          ]),
        )
      : { text: 'В группе нет разделённых расходов.', style: 'empty' },
  )

  const personBlocks: Content[] = []
  for (const person of input.perPerson) {
    const entries = input.breakdown.get(person.name) ?? []
    if (entries.length === 0) continue
    personBlocks.push({
      // Keep a person's heading and their table on the same page.
      unbreakable: true,
      stack: [
        {
          columns: [
            { text: person.name, style: 'personName' },
            {
              text: signedMoney(person.net),
              style: 'personName',
              alignment: 'right',
              color: netColor(person.net),
            },
          ],
          margin: [0, 0, 0, 3],
        },
        dataTable(
          // Fixed money columns so every person's table lines up with the next.
          ['auto', '*', 56, 64, 56, 64],
          ['Дата', 'Расход', 'Доля', 'Отдал / вернули', 'Осталось', 'Итог'],
          entries.map((e) => [
            { text: formatDate(e.date), style: 'dim' },
            {
              text: e.isPayer ? `${e.expenseName} (платил)` : e.expenseName,
              style: 'name',
            },
            { text: money(e.share), style: 'num' },
            { text: e.isPayer ? money(e.received) : money(e.settled), style: 'num' },
            { text: e.isPayer ? '—' : money(e.remaining), style: 'num' },
            { text: signedMoney(e.net), style: 'num', bold: true, color: netColor(e.net) },
          ]),
        ),
      ],
      margin: [0, 0, 0, 10],
    })
  }

  if (personBlocks.length) {
    content.push({ text: 'Детализация по участникам', style: 'sectionHeader' }, ...personBlocks)
  }

  return {
    info: { title, author: 'Shop Assist' },
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 34],
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK, lineHeight: 1.2 },
    content,
    footer: (currentPage: number, pageCount: number): Content => ({
      columns: [
        { text: title, style: 'footer' },
        { text: `${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' },
      ],
      margin: [36, 10, 36, 0],
    }),
    styles: {
      title: { fontSize: 17, bold: true },
      subtitle: { fontSize: 11, bold: true, color: ACCENT, margin: [0, 3, 0, 0] },
      generated: { fontSize: 8, color: MUTED, margin: [0, 4, 0, 0] },
      sectionHeader: {
        fontSize: 8,
        bold: true,
        color: MUTED,
        characterSpacing: 0.6,
        margin: [0, 14, 0, 5],
      },
      th: { fontSize: 7.5, bold: true, color: MUTED, characterSpacing: 0.3 },
      name: { bold: true },
      num: { alignment: 'right' },
      dim: { color: MUTED },
      legend: { fontSize: 7.5, color: MUTED, margin: [0, 5, 0, 0] },
      empty: { color: MUTED },
      warning: { fontSize: 8, color: '#7a5a12' },
      statLabel: { fontSize: 7, color: MUTED, characterSpacing: 0.3 },
      statValue: { fontSize: 11.5, bold: true, margin: [0, 2, 0, 0] },
      personName: { fontSize: 10.5, bold: true },
      footer: { fontSize: 7, color: MUTED },
    },
  }
}
