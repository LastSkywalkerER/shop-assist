import { describe, it, expect } from 'vitest'
import {
  evaluateExpression,
  evaluateForCommit,
  formatCalcValue,
  isExpressionInput,
  sanitizeExpressionInput,
} from './expression'

describe('evaluateExpression', () => {
  it('returns a plain number as-is', () => {
    const res = evaluateExpression('12.5')
    expect(res.value).toBe(12.5)
    expect(res.isExpression).toBe(false)
    expect(res.invalid).toBe(false)
  })

  it('treats a comma as the decimal separator', () => {
    expect(evaluateExpression('12,5').value).toBe(12.5)
    expect(evaluateExpression('1,5+2,5').value).toBe(4)
  })

  it('applies operator precedence', () => {
    expect(evaluateExpression('2+3*4').value).toBe(14)
    expect(evaluateExpression('10-6/2').value).toBe(7)
  })

  it('respects parentheses', () => {
    expect(evaluateExpression('(2+3)*4').value).toBe(20)
    expect(evaluateExpression('2*(3+(4-1))').value).toBe(12)
  })

  it('understands the unicode operator aliases', () => {
    expect(evaluateExpression('3×4').value).toBe(12)
    expect(evaluateExpression('12÷4').value).toBe(3)
    expect(evaluateExpression('5−2').value).toBe(3)
  })

  it('handles unary signs', () => {
    expect(evaluateExpression('-5').value).toBe(-5)
    expect(evaluateExpression('-5+8').value).toBe(3)
    expect(evaluateExpression('3*-2').value).toBe(-6)
  })

  it('applies percent relative to the left operand in sums', () => {
    expect(evaluateExpression('100-15%').value).toBe(85)
    expect(evaluateExpression('100+20%').value).toBe(120)
    expect(evaluateExpression('200+10%-10%').value).toBe(198)
  })

  it('treats percent as a plain fraction in products and alone', () => {
    expect(evaluateExpression('50*20%').value).toBe(10)
    expect(evaluateExpression('20%').value).toBe(0.2)
  })

  it('cleans up floating point noise', () => {
    expect(evaluateExpression('0.1+0.2').value).toBe(0.3)
    expect(evaluateExpression('3.3/3').value).toBe(1.1)
  })

  it('rejects incomplete or malformed input', () => {
    for (const input of ['12+', '*3', '(2+3', '5/0', '1..2', '2 3']) {
      const res = evaluateExpression(input)
      expect(res.value, input).toBeNull()
      expect(res.invalid, input).toBe(true)
    }
  })

  it('reports empty input as neither valid nor invalid', () => {
    const res = evaluateExpression('   ')
    expect(res.value).toBeNull()
    expect(res.invalid).toBe(false)
  })

  it('never executes anything but math', () => {
    // Letters are stripped before parsing, so injected code can't survive:
    // `alert(1)` degrades to the arithmetic `(1)`.
    expect(evaluateExpression('alert(1)').value).toBe(1)
    expect(evaluateExpression('2*window').value).toBeNull()
    expect(evaluateExpression('fetch("/x")').value).toBeNull()
  })
})

describe('evaluateForCommit', () => {
  it('drops a dangling operator', () => {
    expect(evaluateForCommit('12+')).toBe(12)
    expect(evaluateForCommit('12+3*')).toBe(15)
  })

  it('auto-closes unbalanced parentheses', () => {
    expect(evaluateForCommit('(2+3')).toBe(5)
    expect(evaluateForCommit('2*(3+4')).toBe(14)
  })

  it('returns null when nothing sensible remains', () => {
    expect(evaluateForCommit('+++')).toBeNull()
    expect(evaluateForCommit('')).toBeNull()
    expect(evaluateForCommit(')(')).toBeNull()
  })
})

describe('sanitizeExpressionInput', () => {
  it('keeps math characters and drops the rest', () => {
    expect(sanitizeExpressionInput('12+3abc')).toBe('12+3')
    expect(sanitizeExpressionInput('(1,5×2)÷3%')).toBe('(1,5×2)÷3%')
  })
})

describe('isExpressionInput', () => {
  it('ignores a leading sign', () => {
    expect(isExpressionInput('-12.5')).toBe(false)
    expect(isExpressionInput('12')).toBe(false)
    expect(isExpressionInput('12+3')).toBe(true)
    expect(isExpressionInput('-12+3')).toBe(true)
  })
})

describe('formatCalcValue', () => {
  it('rounds and trims trailing zeros', () => {
    expect(formatCalcValue(15)).toBe('15')
    expect(formatCalcValue(15.5)).toBe('15.5')
    expect(formatCalcValue(15.004)).toBe('15')
    expect(formatCalcValue(1 / 3, 3)).toBe('0.333')
  })
})
