import { describe, it, expect } from 'vitest'
import {
  buildSettlementPdf,
  settlementReportFileName,
  settlementReportTitle,
  type SettlementReportInput,
} from './settlementPdf'
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

/** Every string anywhere in the document definition, for content assertions. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) collectText(child, out)
  else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectText(value, out)
  }
  return out
}

describe('settlementReportTitle', () => {
  it('names the report after the group, the date and the time', () => {
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
    expect(settlementReportTitle('Трип по рб', generatedAt)).not.toBe(
      settlementReportTitle('Трип по рб', new Date(2026, 7, 16, 18, 5)),
    )
  })
})

describe('settlementReportFileName', () => {
  it('adds the pdf extension', () => {
    expect(settlementReportFileName('Трип по рб', generatedAt)).toBe(
      'Сводка расходов — Трип по рб — 16.08.2026 12-30.pdf',
    )
  })
})

describe('buildSettlementPdf', () => {
  it('renders every section of the summary', () => {
    const text = collectText(buildSettlementPdf(input()).content)

    expect(text).toContain('Сводка по расходам')
    expect(text).toContain('Трип по рб')
    expect(text).toContain('Баланс участников')
    expect(text).toContain('Кто кому переводит')
    expect(text).toContain('Записанные оплаты')
    expect(text).toContain('Расходы группы')
    expect(text).toContain('Детализация по участникам')
    expect(text).toContain('+427.77\u00A0BYN')
    expect(text).toContain('-181.07\u00A0BYN')
  })

  it('uses A4 and the Cyrillic-capable bundled font', () => {
    const doc = buildSettlementPdf(input())
    expect(doc.pageSize).toBe('A4')
    expect(doc.defaultStyle?.font).toBe('Roboto')
    expect(doc.info?.title).toBe(settlementReportTitle('Трип по рб', generatedAt))
  })

  it('deduplicates the expense list shared by several people', () => {
    const text = collectText(buildSettlementPdf(input()).content)
    // Once in «Расходы группы», once per person in the detail tables.
    expect(text.filter((t) => t.startsWith('Хата гродно'))).toHaveLength(3)
    // The «Всего расходов» tile counts it once.
    expect(text).toContain('1')
  })

  it('marks the payer inside their own detail row', () => {
    const text = collectText(buildSettlementPdf(input()).content)
    expect(text).toContain('Хата гродно (платил)')
  })

  it('says so when nothing is left to transfer', () => {
    const text = collectText(buildSettlementPdf(input({ transfers: [] })).content)
    expect(text).toContain('Все долги погашены.')
  })

  it('omits the payments section when none were recorded', () => {
    const text = collectText(buildSettlementPdf(input({ payments: [] })).content)
    expect(text).not.toContain('Записанные оплаты')
  })

  it('omits the detail section when there is nothing to break down', () => {
    const text = collectText(buildSettlementPdf(input({ breakdown: new Map() })).content)
    expect(text).not.toContain('Детализация по участникам')
    expect(text).toContain('В группе нет разделённых расходов.')
  })

  it('surfaces a conversion gap warning', () => {
    const text = collectText(buildSettlementPdf(input({ conversionGap: true })).content)
    expect(text.some((t) => t.includes('не нашлось курса'))).toBe(true)
  })
})
