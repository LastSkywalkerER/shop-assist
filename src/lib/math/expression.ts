/**
 * Tiny arithmetic expression evaluator behind the calculator inputs.
 *
 * Supports `+ - * / ( )`, a trailing `%` on a term, both `.` and `,` as the
 * decimal separator, and the unicode operator aliases `× ÷ −`. Written as a
 * hand-rolled recursive-descent parser on purpose: no `eval` / `new Function`,
 * so it stays CSP-safe inside the PWA and can't execute anything but math.
 *
 * Percent follows the usual pocket-calculator semantics:
 *   `100-15%` → 85   (percent of the left operand)
 *   `100+20%` → 120
 *   `50*20%`  → 10   (plain fraction in a product)
 *   `20%`     → 0.2
 */

/** Characters a calculator field is allowed to contain. */
const ALLOWED_CHARS = /[^0-9+\-*/().,%×÷х−–—\s]/g

const OPERATOR_ALIASES: Record<string, string> = {
  '×': '*',
  х: '*',
  '÷': '/',
  '−': '-',
  '–': '-',
  '—': '-',
}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string }

/** An operand plus, when it was written as `N%`, the raw percent number. */
interface Operand {
  value: number
  percent: number | null
}

export interface ExpressionEvaluation {
  /** Result of the expression, or null when it can't be evaluated. */
  value: number | null
  /** True when the input is more than a plain number (contains an operation). */
  isExpression: boolean
  /** True when there is text but it doesn't evaluate (yet). */
  invalid: boolean
}

/** Drop everything a calculator field can't contain (letters, emoji, ...). */
export function sanitizeExpressionInput(raw: string): string {
  return raw.replace(ALLOWED_CHARS, '')
}

/** True when the text is an operation rather than a bare (possibly signed) number. */
export function isExpressionInput(raw: string): boolean {
  const trimmed = raw.trim().replace(/^[+-]/, '')
  return /[+\-*/()%×÷х−–—]/.test(trimmed)
}

/** Kill floating-point noise like 0.1 + 0.2 = 0.30000000000000004. */
function denoise(value: number): number {
  return Math.round(value * 1e10) / 1e10
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (/[0-9.,]/.test(ch)) {
      let j = i
      while (j < input.length && /[0-9.,]/.test(input[j])) j++
      const raw = input.slice(i, j).replace(/,/g, '.')
      if ((raw.match(/\./g)?.length ?? 0) > 1) return null
      const value = parseFloat(raw)
      if (!Number.isFinite(value)) return null
      tokens.push({ type: 'num', value })
      i = j
      continue
    }

    const op = OPERATOR_ALIASES[ch] ?? ch
    if ('+-*/()%'.includes(op)) {
      tokens.push({ type: 'op', value: op })
      i++
      continue
    }

    return null
  }

  return tokens
}

class Parser {
  private pos = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  /** Parses the whole token stream; null when it isn't a complete expression. */
  parse(): number | null {
    const result = this.parseSum()
    if (result === null || this.pos !== this.tokens.length) return null
    return Number.isFinite(result.value) ? denoise(result.value) : null
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private eatOp(op: string): boolean {
    const token = this.peek()
    if (token?.type === 'op' && token.value === op) {
      this.pos++
      return true
    }
    return false
  }

  private parseSum(): Operand | null {
    const first = this.parseProduct()
    if (!first) return null
    let left: Operand = first

    for (;;) {
      const token = this.peek()
      if (token?.type !== 'op' || (token.value !== '+' && token.value !== '-')) break
      this.pos++
      const right = this.parseProduct()
      if (!right) return null
      // `100-15%` means "15% of 100", not "minus 0.15".
      const delta: number = right.percent !== null ? (left.value * right.percent) / 100 : right.value
      left = { value: token.value === '+' ? left.value + delta : left.value - delta, percent: null }
    }

    return left
  }

  private parseProduct(): Operand | null {
    const first = this.parseUnary()
    if (!first) return null
    let left: Operand = first

    for (;;) {
      const token = this.peek()
      if (token?.type !== 'op' || (token.value !== '*' && token.value !== '/')) break
      this.pos++
      const right = this.parseUnary()
      if (!right) return null
      if (token.value === '/' && right.value === 0) return null
      left = {
        value: token.value === '*' ? left.value * right.value : left.value / right.value,
        percent: null,
      }
    }

    return left
  }

  private parseUnary(): Operand | null {
    const token = this.peek()
    if (token?.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.pos++
      const operand = this.parseUnary()
      if (!operand) return null
      if (token.value === '+') return operand
      return {
        value: -operand.value,
        percent: operand.percent === null ? null : -operand.percent,
      }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Operand | null {
    const primary = this.parsePrimary()
    if (!primary) return null
    let operand: Operand = primary
    while (this.eatOp('%')) {
      operand = { value: operand.value / 100, percent: operand.value }
    }
    return operand
  }

  private parsePrimary(): Operand | null {
    const token = this.peek()
    if (!token) return null

    if (token.type === 'num') {
      this.pos++
      return { value: token.value, percent: null }
    }

    if (token.value === '(') {
      this.pos++
      const inner = this.parseSum()
      if (!inner) return null
      if (!this.eatOp(')')) return null
      return { value: inner.value, percent: null }
    }

    return null
  }
}

/** Evaluate a calculator field exactly as typed. */
export function evaluateExpression(raw: string): ExpressionEvaluation {
  const trimmed = sanitizeExpressionInput(raw).trim()
  const isExpression = isExpressionInput(trimmed)

  if (!trimmed) return { value: null, isExpression: false, invalid: false }

  const tokens = tokenize(trimmed)
  const value = tokens ? new Parser(tokens).parse() : null

  return { value, isExpression, invalid: value === null }
}

/**
 * Evaluate on commit (blur / Enter / «=»), forgiving a half-typed tail: a
 * dangling operator is dropped and unbalanced `(` are auto-closed, so `12+`
 * gives 12 and `(2+3` gives 5. Returns null when nothing sensible remains.
 */
export function evaluateForCommit(raw: string): number | null {
  let text = sanitizeExpressionInput(raw).trim()

  for (let guard = 0; guard < 16 && text; guard++) {
    const { value } = evaluateExpression(text)
    if (value !== null) return value

    if (/[+\-*/(.,%]$/.test(text)) {
      text = text.slice(0, -1).trim()
      continue
    }

    const unclosed = (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0)
    if (unclosed > 0) {
      text = text + ')'.repeat(unclosed)
      continue
    }

    return null
  }

  return null
}

/**
 * Format a computed value for a text field: rounded to `decimals` and without
 * trailing zeros, so the field reads `15.5` rather than `15.50` while editing.
 */
export function formatCalcValue(value: number, decimals = 2): string {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return String(denoise(rounded))
}
