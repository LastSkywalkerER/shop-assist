// Name matching for the bulk-import ignore list. When the user ignores a parsed
// row, its name is stored (room-scoped, synced) and any current/future row whose
// name is (almost) identical is hidden from the reconcile list. Pure functions.
//
// Matching is intentionally conservative — it merges a name with a truncated
// ("…") or longer variant of itself, but never merges two distinct merchants
// that merely share a generic prefix (e.g. "Retail BLR MINSK TORGOVY" vs
// "Retail BLR MINSK STOLOVAYA"), since neither token set contains the other.

/** Lowercase, strip punctuation/ellipsis, collapse whitespace. */
export function normalizeIgnoreName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(s: string): string[] {
  return s ? s.split(' ').filter(Boolean) : []
}

/** True when two raw names refer to the same thing for ignore purposes. */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeIgnoreName(a)
  const nb = normalizeIgnoreName(b)
  if (!na || !nb) return false
  if (na === nb) return true

  // Prefix: a truncated name is a prefix of its fuller form (and vice-versa).
  const shorter = na.length <= nb.length ? na : nb
  const longer = shorter === na ? nb : na
  if (shorter.length >= 6 && longer.startsWith(shorter)) return true

  // Token containment: every token of the shorter name appears in the longer
  // one. Requires ≥3 tokens so short generic names don't over-match.
  const ta = tokens(na)
  const tb = tokens(nb)
  const small = ta.length <= tb.length ? ta : tb
  const big = small === ta ? tb : ta
  if (small.length >= 3) {
    const bigSet = new Set(big)
    if (small.every((t) => bigSet.has(t))) return true
  }
  return false
}

/** True when `name` matches any entry in the ignore list. */
export function isIgnored(name: string, ignoreNames: string[]): boolean {
  return ignoreNames.some((ig) => namesMatch(name, ig))
}
