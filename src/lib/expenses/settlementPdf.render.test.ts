/**
 * Renders the report through pdfmake for real.
 *
 * This is the regression guard for the two things a pure doc-definition test
 * cannot see: that the definition is actually valid pdfmake input, and that the
 * bundled Roboto carries Cyrillic glyphs. The app's whole report is in Russian,
 * so a font without them would ship a PDF full of blank boxes.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'
import { buildSettlementPdf } from './settlementPdf'
import type { PersonBalance, PersonExpenseEntry } from './splitting'

const require = createRequire(import.meta.url)

interface NodePdfMake {
  virtualfs: { writeFileSync(name: string, content: string, encoding: string): void }
  addFonts(fonts: unknown): void
  setUrlAccessPolicy(cb: (url: string) => boolean): void
  setLocalAccessPolicy(cb: (path: string) => boolean): void
  createPdf(doc: unknown): { getBuffer(): Promise<Buffer> }
}

function nodePdfMake(): NodePdfMake {
  const pdfMake = require('pdfmake/js/index.js') as NodePdfMake
  const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>
  // The browser build decodes the base64 font payloads itself; on the server
  // the virtual file system has to be told what it is being handed.
  for (const [name, content] of Object.entries(vfs)) {
    pdfMake.virtualfs.writeFileSync(name, content, 'base64')
  }
  pdfMake.setUrlAccessPolicy(() => false)
  pdfMake.setLocalAccessPolicy(() => false)
  pdfMake.addFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  })
  return pdfMake
}

/** Every deflate-compressed object body in the PDF, as latin1 text. */
function inflatedStreams(pdf: Buffer): string[] {
  const streams: string[] = []
  for (const match of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'))
    } catch {
      // Not a deflate stream (font programs, images) — nothing to read here.
    }
  }
  return streams
}

/**
 * Unicode code points the PDF's embedded fonts can map back to text, read from
 * the ToUnicode CMaps. A glyph the font lacks never lands here.
 *
 * A CMap states its mappings two ways: `bfchar` lists `<glyph> <unicode>`
 * pairs, `bfrange` lists `<first> <last> <unicode of first>` triples.
 */
function mappedCodePoints(pdf: Buffer): Set<number> {
  const codes = new Set<number>()
  for (const stream of inflatedStreams(pdf)) {
    for (const section of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, , unicode] of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        codes.add(parseInt(unicode, 16))
      }
    }
    for (const section of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const triple = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
      for (const [, first, last, unicode] of section[1].matchAll(triple)) {
        const span = parseInt(last, 16) - parseInt(first, 16)
        const start = parseInt(unicode, 16)
        for (let i = 0; i <= span; i++) codes.add(start + i)
      }
    }
  }
  return codes
}

const balance = (name: string, net: number): PersonBalance => ({
  name,
  paid: 0,
  share: 0,
  settled: 0,
  categoryPaid: 0,
  net,
})

const entry: PersonExpenseEntry = {
  expenseId: 'e1',
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
}

describe('settlement PDF rendering', () => {
  it('produces a PDF whose fonts cover the Russian text it contains', async () => {
    const doc = buildSettlementPdf({
      groupName: 'Трип по рб',
      baseCurrency: 'BYN',
      perPerson: [balance('Ксюша', 427.77), balance('Костя', -181.07)],
      transfers: [{ from: 'Костя', to: 'Ксюша', amount: 181.07 }],
      breakdown: new Map([['Костя', [entry]]]),
      payments: [{ from: 'Костя', to: 'Ксюша', amount: 50 }],
      conversionGap: false,
      generatedAt: new Date(2026, 7, 16, 12, 30),
    })

    const pdf = await nodePdfMake().createPdf(doc).getBuffer()

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5_000)

    const codes = mappedCodePoints(pdf)
    // Every letter of «Сводка по расходам» must have made it into the font.
    for (const char of 'Сводкапрасхм') {
      expect(codes.has(char.codePointAt(0)!), `missing glyph ${char}`).toBe(true)
    }
  }, 30_000)
})
