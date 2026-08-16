import { describe, it, expect } from 'vitest'
import {
  buildSettlementReportHtml,
  escapeHtml,
  settlementReportTitle,
  type SettlementReportInput,
} from './settlementReport'
import type { PersonBalance, PersonExpenseEntry } from './splitting'

// Built in local time on purpose: the title is formatted for the user's own
// clock, so a UTC literal would make this test depend on the machine's zone.
const generatedAt = new Date(2026, 7, 16, 12, 30)

const balance = (over: Partial<PersonBalance> & { name: string }): PersonBalance => ({
  paid: 0,
  share: 0,
  settled: 0,
  categoryPaid: 0,
  net: 0,
  ...over,
})

const entry = (over: Partial<PersonExpenseEntry> & { expenseId: string }): PersonExpenseEntry => ({
  expenseName: 'Хата гродно',
  date: '2026-08-12T10:00:00.000Z',
  currency: 'BYN',
  amountNative: 400,
  payerName: 'Ксюша',
  isPayer: false,
  participantRows: [],
  paid: 0,
  share: 80,
  settled: 0,
  received: 0,
  net: -80,
  remaining: 80,
  remainingNative: 80,
  conversionGap: false,
  ...over,
})

const input = (over: Partial<SettlementReportInput> = {}): SettlementReportInput => ({
  groupName: 'Трип по рб',
  baseCurrency: 'BYN',
  perPerson: [
    balance({ name: 'Ксюша', paid: 990, share: 322.23, net: 427.77 }),
    balance({ name: 'Костя', paid: 141.17, share: 322.24, net: -181.07 }),
  ],
  transfers: [{ from: 'Костя', to: 'Ксюша', amount: 181.07 }],
  breakdown: new Map([
    ['Ксюша', [entry({ expenseId: 'e1', isPayer: true, paid: 400, net: 320, remaining: 0 })]],
    ['Костя', [entry({ expenseId: 'e1' })]],
  ]),
  payments: [{ from: 'Костя', to: 'Ксюша', amount: 50 }],
  conversionGap: false,
  generatedAt,
  ...over,
})

describe('escapeHtml', () => {
  it('neutralizes markup in user-entered names', () => {
    expect(escapeHtml('<b>A & "B"</b>')).toBe('&lt;b&gt;A &amp; &quot;B&quot;&lt;/b&gt;')
  })
})

describe('settlementReportTitle', () => {
  it('names the file after the group and the date', () => {
    expect(settlementReportTitle('Трип по рб', generatedAt)).toBe(
      'Сводка расходов — Трип по рб — 16.08.2026 12-30',
    )
  })

  it('falls back when the group has no name', () => {
    expect(settlementReportTitle('  ', generatedAt)).toContain('Без группы')
  })

  it('strips characters a filesystem would reject', () => {
    const title = settlementReportTitle('Трип 07/08 : "юг"', generatedAt)
    expect(title).not.toMatch(/[\\/:*?"<>|]/)
    expect(title).toContain('Трип 07 08')
  })

  it('separates two exports of the same group made on the same day', () => {
    const later = new Date(2026, 7, 16, 18, 5)
    expect(settlementReportTitle('Трип по рб', generatedAt)).not.toBe(
      settlementReportTitle('Трип по рб', later),
    )
  })
})

describe('buildSettlementReportHtml', () => {
  it('renders every section of the summary', () => {
    const html = buildSettlementReportHtml(input())

    expect(html).toContain('Сводка по расходам')
    expect(html).toContain('Трип по рб')
    expect(html).toContain('Баланс участников')
    expect(html).toContain('Кто кому переводит')
    expect(html).toContain('Записанные оплаты')
    expect(html).toContain('Расходы группы')
    expect(html).toContain('Детализация по участникам')
    // Balances and transfers carry their figures.
    expect(html).toContain('+427.77')
    expect(html).toContain('-181.07')
    expect(html).toContain('181.07')
  })

  it('deduplicates the expense list shared by several people', () => {
    const html = buildSettlementReportHtml(input())
    const rows = html.match(/Хата гродно/g) ?? []
    // Once in «Расходы группы», once per person in the detail tables.
    expect(rows.length).toBe(3)
    expect(html).toContain('<div class="stat-value">1</div>')
  })

  it('says so when nothing is left to transfer', () => {
    const html = buildSettlementReportHtml(input({ transfers: [] }))
    expect(html).toContain('Все долги погашены.')
  })

  it('omits the payments section when none were recorded', () => {
    const html = buildSettlementReportHtml(input({ payments: [] }))
    expect(html).not.toContain('Записанные оплаты')
  })

  it('surfaces a conversion gap warning', () => {
    expect(buildSettlementReportHtml(input({ conversionGap: true }))).toContain(
      'не нашлось курса',
    )
  })

  it('prints itself, so the dialog belongs to the report document', () => {
    const html = buildSettlementReportHtml(input())
    expect(html).toContain('window.print()')
    // The title drives the default PDF file name, so it has to be in the head.
    expect(html).toContain(`<title>${settlementReportTitle('Трип по рб', generatedAt)}</title>`)
  })

  it('escapes names coming from user input', () => {
    const html = buildSettlementReportHtml(
      input({ perPerson: [balance({ name: '<script>x</script>' })], breakdown: new Map() }),
    )
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })
})
