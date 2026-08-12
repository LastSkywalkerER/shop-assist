import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalcInputApi } from '../../hooks/useCalcInput'

/** Operator keys — the mobile decimal keyboard has none of these. */
const KEYS: Array<{ label: string; token: string; compact: boolean }> = [
  { label: '+', token: '+', compact: true },
  { label: '−', token: '-', compact: true },
  { label: '×', token: '*', compact: true },
  { label: '÷', token: '/', compact: true },
  { label: '%', token: '%', compact: false },
  { label: '(', token: '(', compact: false },
  { label: ')', token: ')', compact: false },
]

/** Gap between the field and the panel. */
const GAP = 6
/** Keep-away margin from the viewport edges. */
const EDGE = 8
/** Narrow fields (a 120px «Количество») still get a usable keypad. */
const MIN_WIDTH = 220

interface CalcKeypadProps {
  calc: CalcInputApi
  /** Drop the rarely used keys — for fields sitting in a narrow column. */
  compact?: boolean
  className?: string
}

interface PanelPosition {
  top: number
  left: number
  width: number
}

/**
 * Operator strip for a `useCalcInput` field. Rendered only while the field is
 * focused, as a portal anchored to the input — it floats over the layout
 * instead of sitting in the flow, so opening it never shifts the form. The
 * panel flips above the field when there is no room below.
 *
 * `mousedown` is swallowed on the panel so tapping a key keeps the caret (and
 * the on-screen keyboard) exactly where it was; propagation is stopped as well
 * so document-level outside-click handlers don't treat the portal as "outside".
 */
export function CalcKeypad({ calc, compact = false, className = '' }: CalcKeypadProps) {
  const { anchorEl, focused, draft } = calc
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const open = focused && anchorEl !== null

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPosition(null)
      return
    }

    const update = () => {
      const rect = anchorEl.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight

      const width = Math.min(Math.max(rect.width, MIN_WIDTH), viewportWidth - EDGE * 2)
      let left = rect.left
      if (left + width > viewportWidth - EDGE) left = viewportWidth - EDGE - width
      if (left < EDGE) left = EDGE

      // Flip above the field when the panel would hang off the bottom (the
      // on-screen keyboard shrinks visualViewport, so this reacts to it too).
      const height = panelRef.current?.offsetHeight ?? 0
      let top = rect.bottom + GAP
      if (height > 0 && top + height > viewportHeight - EDGE && rect.top - GAP - height > EDGE) {
        top = rect.top - GAP - height
      }

      setPosition((prev) =>
        prev && prev.top === top && prev.left === left && prev.width === width
          ? prev
          : { top, left, width },
      )
    }

    update()

    // `capture` so scrolling of any ancestor container moves the panel too.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
    // `draft` and `compact` change the panel height / key count — reposition.
  }, [open, anchorEl, compact, draft])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    // Native listeners: React's synthetic stopPropagation would not stop
    // document-level handlers, which outside-click logic relies on.
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    // Touch is not prevented (that would swallow the click), only contained.
    const onTouchStart = (e: TouchEvent) => e.stopPropagation()
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('touchstart', onTouchStart)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      el.removeEventListener('touchstart', onTouchStart)
    }
  }, [open])

  if (!open) return null

  const keys = compact ? KEYS.filter((k) => k.compact) : KEYS

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: position?.width,
        // Hidden for the first (measuring) pass, before `top` is known.
        visibility: position ? 'visible' : 'hidden',
      }}
      className={`z-[9999] rounded-xl glass border border-separator/20 shadow-[0_4px_20px_rgba(0,0,0,0.18)] px-1.5 py-1.5 space-y-1 select-none ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] text-text-hint truncate">
          {calc.invalid
            ? 'Не удаётся посчитать'
            : draft.trim() === '' && !compact
              ? 'Калькулятор — например 12+3×2'
              : 'Калькулятор'}
        </span>
        {calc.preview !== null && (
          <span className="text-[12px] font-semibold text-primary-text tabular-nums shrink-0">
            = {calc.preview}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {keys.map((key) => (
          <button
            key={key.token}
            type="button"
            tabIndex={-1}
            onClick={() => calc.insert(key.token)}
            className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-surface text-[15px] text-text font-medium active:bg-primary/10 transition-colors"
          >
            {key.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          onClick={calc.backspace}
          aria-label="Стереть"
          className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-surface text-[15px] text-text-hint active:bg-primary/10 transition-colors"
        >
          ⌫
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={calc.commit}
          aria-label="Посчитать"
          className="flex-1 basis-[calc(20%-4px)] min-w-[32px] py-1.5 rounded-lg bg-primary text-on-primary text-[15px] font-semibold active:opacity-80 transition-opacity"
        >
          =
        </button>
      </div>
    </div>,
    document.body,
  )
}
