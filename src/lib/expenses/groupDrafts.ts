/**
 * Expense groups live denormalized on the expense (`expense.groupName`), so a
 * group only exists as long as some expense points at it. To still allow
 * «создать группу, потом добавить расходы», freshly created but still empty
 * groups are kept here as device-local drafts; a draft disappears from the
 * list on its own once the group has at least one expense.
 *
 * Drafts are intentionally not synced — an empty group carries no data, and
 * this avoids a 17th RxDB collection (the open-source build caps at 16).
 */

const STORAGE_KEY = 'expense_group_drafts'
/** Same-tab notification (the `storage` event only fires in other tabs). */
const CHANGE_EVENT = 'expense-group-drafts-changed'

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
  } catch {
    return []
  }
}

function write(names: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names))
  } catch {
    // Quota or private-mode failures must not break group creation.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Cached snapshot so `useSyncExternalStore` sees a stable reference. */
let snapshot: string[] = read()

function refresh(): void {
  snapshot = read()
}

export function getGroupDrafts(): string[] {
  return snapshot
}

export function addGroupDraft(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const existing = read()
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return
  write([...existing, trimmed])
  refresh()
}

export function removeGroupDraft(name: string): void {
  const trimmed = name.trim().toLowerCase()
  write(read().filter((n) => n.toLowerCase() !== trimmed))
  refresh()
}

export function renameGroupDraft(from: string, to: string): void {
  const fromKey = from.trim().toLowerCase()
  const target = to.trim()
  if (!target) return
  write(read().map((n) => (n.toLowerCase() === fromKey ? target : n)))
  refresh()
}

export function subscribeGroupDrafts(onChange: () => void): () => void {
  const handler = () => {
    refresh()
    onChange()
  }
  window.addEventListener(CHANGE_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
