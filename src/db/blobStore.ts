/**
 * Blob store for binary attachment data.
 *
 * Uses a dedicated IndexedDB database with a persistent singleton connection
 * (instead of open/close per operation). The store lives in `src/db/` and its
 * lifecycle is tied to the main RxDB database — see `resetBlobStore()` and
 * `closeBlobStore()` called from `database.ts` and `SyncContext.tsx`.
 */

const DB_NAME = 'shopassist-file-blobs'
const STORE_NAME = 'blobs'
const DB_VERSION = 1
const PENDING_UPLOADS_KEY = 'shopassist_pending_uploads'

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

let _db: IDBDatabase | null = null
let _opening: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (_opening) return _opening

  _opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => {
      _db = req.result
      _db.onclose = () => { _db = null; _opening = null }
      resolve(_db)
    }
    req.onerror = () => { _opening = null; reject(req.error) }
  })

  return _opening
}

/** Close the singleton connection (called alongside RxDB reset). */
export function closeBlobStore(): void {
  if (_db) { _db.close(); _db = null; _opening = null }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function blobStorePut(id: string, blob: Blob): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function blobStoreGet(id: string): Promise<Blob | null> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
    req.onerror = () => reject(req.error)
  })
}

export async function blobStoreRemove(id: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function blobStoreClearAll(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// Pending-upload tracking (localStorage — survives page reload)
// ---------------------------------------------------------------------------

export function getPendingUploads(): Set<string> {
  try {
    const stored = localStorage.getItem(PENDING_UPLOADS_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

export function addPendingUpload(id: string): void {
  const set = getPendingUploads()
  set.add(id)
  localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify([...set]))
}

export function removePendingUpload(id: string): void {
  const set = getPendingUploads()
  set.delete(id)
  localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify([...set]))
}

export function clearPendingUploads(): void {
  localStorage.removeItem(PENDING_UPLOADS_KEY)
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
