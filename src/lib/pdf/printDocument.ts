/**
 * Print a standalone HTML document, so the user can save it as a PDF from the
 * browser's own print dialog ("Сохранить в PDF" / "Save as PDF").
 *
 * Going through the browser keeps Cyrillic typography, page breaks and font
 * embedding entirely on the platform — no PDF library and no bundled font.
 */

/** How long the hidden frame stays alive after the dialog opens. */
const CLEANUP_DELAY_MS = 60_000

function removeFrame(frame: HTMLIFrameElement): void {
  if (frame.parentNode) frame.parentNode.removeChild(frame)
}

/**
 * Open the given document in a new tab instead of printing it. Used when the
 * embedding webview has no working `print()` — the user can still read, share
 * or print the report from there.
 */
function openInNewTab(html: string): boolean {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  // Revoking too early breaks the load in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), CLEANUP_DELAY_MS)
  if (!win) {
    URL.revokeObjectURL(url)
    return false
  }
  return true
}

export type PrintOutcome = 'printed' | 'opened-tab' | 'failed'

/**
 * Render `html` into an off-screen iframe and open the print dialog on it.
 *
 * Resolves with what actually happened: `printed` when the dialog was opened,
 * `opened-tab` when the document had to fall back to a new tab, and `failed`
 * when even that was blocked (pop-up blocker).
 */
export function printHtmlDocument(html: string): Promise<PrintOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    // Off-screen rather than `display: none`: hidden frames print blank in
    // WebKit, and a zero-sized visible frame prints reliably everywhere.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'

    let settled = false
    const finish = (outcome: PrintOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    frame.onload = () => {
      const win = frame.contentWindow
      if (!win || typeof win.print !== 'function') {
        removeFrame(frame)
        finish(openInNewTab(html) ? 'opened-tab' : 'failed')
        return
      }

      // Some engines fire `afterprint` on the frame, some on its opener; the
      // timeout is the backstop so the frame never leaks.
      const cleanup = () => removeFrame(frame)
      win.addEventListener('afterprint', cleanup, { once: true })
      setTimeout(cleanup, CLEANUP_DELAY_MS)

      try {
        win.focus()
        win.print()
        finish('printed')
      } catch {
        cleanup()
        finish(openInNewTab(html) ? 'opened-tab' : 'failed')
      }
    }

    document.body.appendChild(frame)
    frame.srcdoc = html
  })
}
