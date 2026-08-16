/**
 * Hand a standalone HTML document to the browser's print flow, so the user can
 * save it as a PDF ("Сохранить в PDF" / "Save as PDF").
 *
 * The document is opened as its own top-level page and prints *itself* (see the
 * inline script the report carries). Printing it from a hidden iframe instead
 * does not work: Chrome on Android cannot print a subframe and silently prints
 * the top-level document, which produced a blank page and named the PDF after
 * the app's own <title>. A real page also makes the report's title the default
 * file name, which is the whole point of naming it after the group and date.
 */

/** Revoking a blob URL immediately aborts the load in some browsers. */
const REVOKE_DELAY_MS = 60_000

export type PrintOutcome = 'printing' | 'blocked'

/** True once the document actually received the markup we wrote into it. */
function hasContent(doc: Document | null): boolean {
  return !!doc?.body && doc.body.childElementCount > 0
}

/**
 * Open `html` in a new tab that prints itself.
 *
 * Synchronous on purpose: `window.open` is only allowed inside the user gesture
 * that triggered it, so awaiting anything first gets the pop-up blocked.
 * Returns `blocked` when the browser refused to open the tab at all.
 */
export function openPrintableDocument(html: string): PrintOutcome {
  const win = window.open('', '_blank')
  if (win) {
    try {
      win.document.open()
      win.document.write(html)
      win.document.close()
      // Some in-app browsers hand back a window that accepts writes and drops
      // them, so confirm the markup landed before trusting this path.
      if (hasContent(win.document)) {
        win.focus()
        return 'printing'
      }
    } catch {
      // Window is not scriptable — fall through to the blob route.
    }
    try {
      win.close()
    } catch {
      // Already gone.
    }
  }

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const blobWin = window.open(url, '_blank')
  if (!blobWin) {
    URL.revokeObjectURL(url)
    return 'blocked'
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  return 'printing'
}
