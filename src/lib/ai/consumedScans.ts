// Local registry of pending_receipt_scans that have already been turned into
// an expense (promoted) but whose remote row delete may not have completed
// yet — e.g. the device was offline when the user saved. The expense itself
// is written to local RxDB and syncs later, but the pending_receipt_scans
// table is cloud-only, so without this registry the "Распознаём чек / готово"
// card would linger and could be opened + saved a second time, producing an
// RxDB CONFLICT (duplicate receiptItem / attachment ids) and a duplicate
// expense. See docs/AI_FEATURE_NOTES.md → "Async scan flow".
//
// usePendingScans filters these ids out of the rendered list, retries the
// deferred delete on every refetch, and prunes ids once the server row is
// actually gone.

const KEY = 'shop-assist:consumed-pending-scans'
const EVENT = 'consumed-scans-changed'

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    /* ignore quota / unavailable storage */
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Hide a scan's card immediately and remember to clean up its server row. */
export function markScanConsumed(id: string): void {
  const ids = read()
  if (!ids.includes(id)) write([...ids, id])
}

/** Drop a scan from the registry once its server row is confirmed gone. */
export function unmarkScanConsumed(id: string): void {
  const ids = read()
  if (ids.includes(id)) write(ids.filter((x) => x !== id))
}

export function getConsumedScans(): Set<string> {
  return new Set(read())
}

export const CONSUMED_SCANS_EVENT = EVENT
