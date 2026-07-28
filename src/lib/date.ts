/**
 * Helpers for `<input type="date">` fields that are backed by a full ISO timestamp.
 *
 * The app stores calendar dates as ISO strings (`expense.date`, `purchase.purchaseDate`)
 * and groups/sorts by their leading `YYYY-MM-DD` part. Editing must therefore change
 * only that part and keep the time-of-day, otherwise every save collapses the record
 * to the start of the day.
 */

const START_OF_DAY = '00:00:00.000Z'
const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/

/** Value for an `<input type="date">` built from a stored ISO timestamp. */
export function toDateInputValue(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

/**
 * Combines the day picked in a date input with the time-of-day of the original
 * timestamp. An unchanged day returns the original ISO string byte for byte;
 * a changed day keeps hours/minutes/seconds (and any UTC offset) as they were.
 * Timestamps stored without a time part fall back to the start of the day.
 */
export function withDatePart(originalIso: string | undefined, dateInput: string): string {
  if (!DATE_INPUT_RE.test(dateInput)) {
    // Empty or malformed input (date pickers can be cleared) — keep what we had.
    return originalIso ?? new Date().toISOString()
  }
  const time = originalIso && originalIso.length > 11 ? originalIso.slice(11) : START_OF_DAY
  return `${dateInput}T${time}`
}
