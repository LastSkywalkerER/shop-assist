/**
 * Client-side PDF generation.
 *
 * pdfmake is used rather than the browser's print dialog because printing is
 * not reliable where this app actually runs: Chrome on Android refuses to print
 * a subframe, and an installed PWA gives no usable print target either. This
 * produces a real .pdf file with real, selectable text, under a name we choose.
 *
 * pdfmake ships Roboto with Cyrillic coverage, so no font has to be bundled by
 * hand. Both pdfmake and its fonts are ~2 MB, so they are imported dynamically:
 * nothing is downloaded until the user actually exports something.
 */
import type {
  TDocumentDefinitions,
  TCreatedPdf,
  TFontDictionary,
  TVirtualFileSystem,
} from 'pdfmake/interfaces'

/** The slice of pdfmake's browser build this module uses. */
interface PdfMakeApi {
  addVirtualFileSystem(vfs: TVirtualFileSystem): void
  addFonts(fonts: TFontDictionary): void
  createPdf(documentDefinition: TDocumentDefinitions): TCreatedPdf
}

/** Roboto is the family bundled with pdfmake; it covers Cyrillic. */
const FONTS: TFontDictionary = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
}

let pdfMakePromise: Promise<PdfMakeApi> | null = null

/**
 * Both builds are UMD, so depending on how the bundler interops them the module
 * namespace is either the export object itself or wraps it in `default`.
 */
function unwrap<T>(module: unknown): T {
  const withDefault = module as { default?: T }
  return withDefault?.default ?? (module as T)
}

/** Load and configure pdfmake once; later exports reuse the same instance. */
function loadPdfMake(): Promise<PdfMakeApi> {
  pdfMakePromise ??= (async () => {
    const [pdfMakeModule, vfsModule] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ])
    const pdfMake = unwrap<PdfMakeApi>(pdfMakeModule)
    pdfMake.addVirtualFileSystem(unwrap<TVirtualFileSystem>(vfsModule))
    pdfMake.addFonts(FONTS)
    return pdfMake
  })().catch((error) => {
    // Let the next attempt retry instead of caching a failed network load.
    pdfMakePromise = null
    throw error
  })
  return pdfMakePromise
}

/** Hand a finished blob to the browser as a download. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  if ('download' in link) {
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } else {
    // No download attribute (old in-app webviews): showing the file is still
    // better than doing nothing — the viewer can save it from there.
    window.open(url, '_blank')
  }
  // Revoking synchronously can cancel a download that has not started yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Render a pdfmake document and save it as `fileName`.
 * Rejects if pdfmake could not be loaded or the document failed to render.
 */
export async function downloadPdf(
  documentDefinition: TDocumentDefinitions,
  fileName: string,
): Promise<void> {
  const pdfMake = await loadPdfMake()
  const blob = await pdfMake.createPdf(documentDefinition).getBlob()
  saveBlob(blob, fileName)
}
