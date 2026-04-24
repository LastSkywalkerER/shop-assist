/**
 * GS1 Application Identifier helpers.
 *
 * Most "modern" 2D codes on consumer goods (Russia/Belarus «Честный знак»,
 * EU pharma, EU 2023/1542 batteries) encode a GS1 element string starting
 * with `01<14-digit GTIN>` and optionally further AIs (`21` serial,
 * `17` expiry, `10` lot, `91` / `92` extra). DataMatrix payloads usually
 * begin with the FNC1 group separator (ASCII 29), and ZXing prefixes its
 * raw text with the symbology identifier `]d2` for GS1 DataMatrix.
 *
 * GS1 Digital Link adds a URL form: `https://<host>/01/<GTIN>/...`.
 * Both forms boil down to a 13- or 14-digit GTIN that we can look up in
 * Open Food Facts via the existing `lookup-product-by-barcode` Edge
 * Function.
 */

// FNC1 group separator (ASCII 29) — terminates variable-length GS1 AIs
// when DataMatrix / QR encodes them.
const GS = String.fromCharCode(29)
const SYMBOLOGY_PREFIXES = [']d2', ']Q3', ']C1', ']e0']

/** Strip ZXing symbology identifier and FNC1 separators from the head. */
function stripSymbology(raw: string): string {
  let s = raw
  for (const p of SYMBOLOGY_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length)
      break
    }
  }
  while (s.startsWith(GS)) s = s.slice(1)
  return s
}

/**
 * Extract a GTIN (8/12/13/14 digit) from any of:
 * - bare numeric barcode (`4810268032738`)
 * - GS1 element string starting with AI `01` (`010481026803273821ABC123`)
 * - GS1 Digital Link URL (`https://id.gs1.org/01/04810268032738/21/X`)
 *
 * Returns the GTIN as found (without normalising to 13 digits) so the
 * caller can decide whether to trim a leading zero. Returns null if
 * nothing GTIN-like is present.
 */
export function extractGtin(raw: string): string | null {
  if (!raw) return null

  // 1) Plain numeric (EAN/UPC/ITF-14/GTIN-8).
  const numeric = raw.replace(/\D/g, '')
  if (raw === numeric && /^\d{8}$|^\d{12,14}$/.test(numeric)) {
    return numeric
  }

  // 2) GS1 Digital Link URL — look for `/01/<digits>` segment.
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/\/01\/(\d{8,14})(?:\/|$|\?|#)/)
    return m ? m[1] : null
  }

  // 3) GS1 element string. Strip optional symbology prefix / FNC1, then
  //    look for AI `01` at the head and read the next 14 digits.
  const stripped = stripSymbology(raw)
  if (stripped.startsWith('01') && /^\d{16}/.test(stripped)) {
    return stripped.slice(2, 16)
  }

  // 4) Fallback: maybe AI `01` is somewhere mid-string after a GS separator.
  const sepRe = new RegExp(`(?:^|${GS})01(\\d{14})`)
  const mid = stripped.match(sepRe)
  return mid ? mid[1] : null
}

/**
 * Convert a 14-digit GTIN-14 to its 13-digit EAN form by stripping the
 * leading zero. OFF accepts both forms but EAN-13 is what most 1D scans
 * resolve to, so unifying helps cache hits and dedupe.
 */
export function normaliseGtin(gtin: string): string {
  if (gtin.length === 14 && gtin.startsWith('0')) return gtin.slice(1)
  return gtin
}
