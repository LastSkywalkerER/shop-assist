import { PIE_OTHER_LABEL } from '../../lib/analytics/aggregate'

/**
 * Fixed chart palette. Hardcoded hexes (instead of --tg-theme vars) because
 * the Telegram theme only provides 1-2 accent colors — not enough for 8 pie
 * slices — and these mid-tone hues stay legible on both dark and light themes.
 */
export const CHART_COLORS = [
  '#5B8DEF',
  '#F2994A',
  '#27AE60',
  '#EB5757',
  '#9B51E0',
  '#2D9CDB',
  '#F2C94C',
  '#FF7AB6',
]

/** Reserved gray for the «Другое» slice. */
export const OTHER_COLOR = '#8E8E93'

export function sliceColor(name: string, index: number): string {
  if (name === PIE_OTHER_LABEL) return OTHER_COLOR
  return CHART_COLORS[index % CHART_COLORS.length]
}
