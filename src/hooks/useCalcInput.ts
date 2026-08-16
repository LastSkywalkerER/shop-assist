import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  evaluateExpression,
  evaluateForCommit,
  formatCalcValue,
  sanitizeExpressionInput,
} from '../lib/math/expression'

export interface UseCalcInputOptions {
  /** Committed numeric value owned by the parent (a plain numeric string). */
  value: string
  /** Called with the evaluated numeric string — never with a raw expression. */
  onChange: (value: string) => void
  /** Decimals kept when a result is committed. Default 2 (money). */
  decimals?: number
  /** Optional clamps applied to computed results. */
  min?: number
  max?: number
  /** Invoked after Enter commits the field (e.g. to submit a quick-add bar). */
  onEnter?: () => void
}

export interface CalcInputApi {
  /** The field element, so the keypad can anchor itself to it. */
  anchorEl: HTMLInputElement | null
  /** Spread onto the `<input>` element. */
  inputProps: {
    ref: (el: HTMLInputElement | null) => void
    type: 'text'
    inputMode: 'decimal'
    autoComplete: 'off'
    autoCorrect: 'off'
    spellCheck: false
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  }
  /** Raw text currently in the field (may be a half-typed expression). */
  draft: string
  focused: boolean
  /** Live result of the typed expression, e.g. `15.5`. Null for plain numbers. */
  preview: string | null
  /** True when the field holds text that doesn't evaluate. */
  invalid: boolean
  insert: (token: string) => void
  backspace: () => void
  clear: () => void
  commit: () => void
  /**
   * Empty the field and the parent value without touching focus — for a form
   * that clears itself while the field is still focused (the quick-add bar
   * submits, then moves focus away, which would otherwise blur-commit the
   * just-submitted draft straight back into the parent).
   */
  reset: () => void
}

/**
 * Turns a numeric field into a mini calculator: the user may type
 * `12+3*2` (or tap the operators on `CalcKeypad`) and the parent keeps
 * receiving a normalized numeric string.
 *
 * The raw expression lives in local state only — the parent is updated with
 * the evaluated result as soon as the expression is valid, so downstream math
 * (totals, validation) never sees `12+3`. Blur / Enter / «=» rewrite the field
 * itself with the result.
 */
export function useCalcInput({
  value,
  onChange,
  decimals = 2,
  min,
  max,
  onEnter,
}: UseCalcInputOptions): CalcInputApi {
  const [draft, setDraft] = useState(value)
  /** Mirrors `draft` so callbacks (blur, keypad) never act on a stale closure. */
  const draftRef = useRef(draft)
  const setDraftValue = useCallback((next: string) => {
    draftRef.current = next
    setDraft(next)
  }, [])
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** Same node as `inputRef`, in state so the keypad re-renders once it mounts. */
  const [anchorEl, setAnchorEl] = useState<HTMLInputElement | null>(null)
  /** Last value this hook pushed up — used to tell our own echo apart from
   *  an external change (a picked suggestion, a reset form, ...). */
  const lastPushed = useRef(value)

  useEffect(() => {
    if (value !== lastPushed.current) {
      lastPushed.current = value
      setDraftValue(value)
    }
  }, [value, setDraftValue])

  const clamp = useCallback(
    (raw: number) => {
      let next = raw
      if (min !== undefined && next < min) next = min
      if (max !== undefined && next > max) next = max
      return next
    },
    [min, max],
  )

  const push = useCallback(
    (next: string) => {
      lastPushed.current = next
      onChange(next)
    },
    [onChange],
  )

  /** Update the field and, when the expression resolves, the parent value. */
  const applyDraft = useCallback(
    (next: string) => {
      setDraftValue(next)
      const trimmed = next.trim()
      if (!trimmed) {
        push('')
        return
      }
      const { value: result } = evaluateExpression(trimmed)
      // A half-typed expression keeps the previously pushed value instead of
      // blanking the parent on every keystroke.
      if (result !== null) push(formatCalcValue(clamp(result), decimals))
    },
    [push, clamp, decimals, setDraftValue],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyDraft(sanitizeExpressionInput(e.currentTarget.value))
    },
    [applyDraft],
  )

  const commit = useCallback(() => {
    // Read through the ref: blur can fire after the form already reset the
    // field, and the closure's `draft` would still hold the old text.
    const trimmed = draftRef.current.trim()
    if (!trimmed) {
      setDraftValue('')
      push('')
      return
    }
    const result = evaluateForCommit(trimmed)
    if (result === null) {
      // Unusable leftovers — fall back to the last value the parent knows.
      setDraftValue(lastPushed.current)
      return
    }
    const formatted = formatCalcValue(clamp(result), decimals)
    setDraftValue(formatted)
    push(formatted)
  }, [push, clamp, decimals, setDraftValue])

  const setCaret = useCallback((position: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(position, position)
    })
  }, [])

  const insert = useCallback(
    (token: string) => {
      const el = inputRef.current
      const current = draftRef.current
      const start = el?.selectionStart ?? current.length
      const end = el?.selectionEnd ?? start
      applyDraft(current.slice(0, start) + token + current.slice(end))
      setCaret(start + token.length)
    },
    [applyDraft, setCaret],
  )

  const backspace = useCallback(() => {
    const el = inputRef.current
    const current = draftRef.current
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? start
    if (start === end) {
      if (start === 0) return
      applyDraft(current.slice(0, start - 1) + current.slice(end))
      setCaret(start - 1)
      return
    }
    applyDraft(current.slice(0, start) + current.slice(end))
    setCaret(start)
  }, [applyDraft, setCaret])

  const clear = useCallback(() => {
    applyDraft('')
    setCaret(0)
  }, [applyDraft, setCaret])

  const reset = useCallback(() => {
    setDraftValue('')
    push('')
  }, [push, setDraftValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
        onEnter?.()
      }
    },
    [commit, onEnter],
  )

  const { preview, invalid } = useMemo(() => {
    const evaluation = evaluateExpression(draft)
    return {
      preview:
        evaluation.isExpression && evaluation.value !== null
          ? formatCalcValue(clamp(evaluation.value), decimals)
          : null,
      invalid: evaluation.invalid,
    }
  }, [draft, clamp, decimals])

  const setRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
    setAnchorEl(el)
  }, [])

  return {
    anchorEl,
    inputProps: {
      ref: setRef,
      type: 'text',
      inputMode: 'decimal',
      autoComplete: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      value: draft,
      onChange: handleChange,
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false)
        commit()
      },
      onKeyDown: handleKeyDown,
    },
    draft,
    focused,
    preview,
    invalid,
    insert,
    backspace,
    clear,
    commit,
    reset,
  }
}
