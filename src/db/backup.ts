import type { ShopAssistDatabase } from './database'
import {
  blobStoreGet,
  blobStorePut,
  blobToDataUrl,
  dataUrlToBlob,
  addPendingUpload,
} from './blobStore'

export interface BackupMetadata {
  version: number
  appVersion: string
  timestamp: string
  collections: string[]
  totalDocuments: number
  attachmentSizeBytes: number
}

export interface BackupFile {
  metadata: BackupMetadata
  collections: Record<string, object[]>
}

const COLLECTION_NAMES = [
  'products',
  'stores',
  'purchases',
  'expenseCategories',
  'expenses',
  'receipts',
  'receiptItems',
  'expenseAttachments',
  'shoppingListItems',
  'purchaseAttachments',
] as const

const ATTACHMENT_COLLECTIONS = new Set<string>(['expenseAttachments', 'purchaseAttachments'])

const LAST_BACKUP_META_KEY = 'last_backup_meta'
const FALLBACK_DEXIE_DB_NAME = 'shopassist-rxdb'

// ---------------------------------------------------------------------------
// Raw IndexedDB access (pre-migration, before RxDB is initialized)
// ---------------------------------------------------------------------------

async function findDexieDbName(): Promise<string> {
  try {
    const dbs = await indexedDB.databases()
    const match = dbs.find((db) => db.name?.startsWith('shopassist'))
    return match?.name ?? FALLBACK_DEXIE_DB_NAME
  } catch {
    return FALLBACK_DEXIE_DB_NAME
  }
}

/**
 * Reads all documents from the raw Dexie/RxDB IndexedDB database
 * WITHOUT initializing RxDB. Safe to call before createRxDatabase().
 */
export async function readRawIndexedDB(): Promise<Record<string, object[]>> {
  const dbName = await findDexieDbName()

  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName)

    openRequest.onerror = () => reject(openRequest.error)

    openRequest.onupgradeneeded = (event) => {
      // DB doesn't exist yet — abort without creating it
      ;(event.target as IDBOpenDBRequest).transaction?.abort()
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      const storeNames = Array.from(db.objectStoreNames)
      const result: Record<string, object[]> = {}

      const relevantStores = storeNames.filter((name) =>
        COLLECTION_NAMES.some((col) => name === col || name.startsWith(col + '-')),
      )

      if (relevantStores.length === 0) {
        db.close()
        resolve(result)
        return
      }

      const tx = db.transaction(relevantStores, 'readonly')
      let pending = relevantStores.length

      const onDone = () => {
        pending--
        if (pending === 0) {
          db.close()
          resolve(result)
        }
      }

      relevantStores.forEach((storeName) => {
        const store = tx.objectStore(storeName)
        const req = store.getAll()

        req.onsuccess = () => {
          // RxDB/Dexie may wrap docs as { data: actualDoc, ... }
          const docs = (req.result as any[]).map((raw) =>
            raw?.data !== undefined ? raw.data : raw,
          )
          const colName =
            COLLECTION_NAMES.find(
              (col) => storeName === col || storeName.startsWith(col + '-'),
            ) ?? storeName
          if (!result[colName]) result[colName] = []
          result[colName].push(...docs)
          onDone()
        }

        req.onerror = () => onDone()
      })

      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Build BackupFile from raw data (pre-migration)
// ---------------------------------------------------------------------------

export function buildBackupFromRawData(
  rawCollections: Record<string, object[]>,
  appVersion: string,
  dbVersion: number,
): BackupFile {
  const totalDocuments = Object.values(rawCollections).reduce(
    (sum, docs) => sum + docs.length,
    0,
  )
  const expenseAtts = rawCollections['expenseAttachments'] ?? []
  const purchaseAtts = rawCollections['purchaseAttachments'] ?? []
  const attachmentSizeBytes =
    expenseAtts.reduce((sum, doc: any) => sum + (doc?.size ?? 0), 0) +
    purchaseAtts.reduce((sum, doc: any) => sum + (doc?.size ?? 0), 0)

  return {
    metadata: {
      version: dbVersion,
      appVersion,
      timestamp: new Date().toISOString(),
      collections: [...COLLECTION_NAMES],
      totalDocuments,
      attachmentSizeBytes,
    },
    collections: rawCollections,
  }
}

// ---------------------------------------------------------------------------
// Build BackupFile from live RxDB instance (Settings manual backup)
// ---------------------------------------------------------------------------

export async function createBackupFromDb(
  db: ShopAssistDatabase,
  appVersion: string,
  dbVersion: number,
): Promise<BackupFile> {
  const collections: Record<string, object[]> = {}
  let totalDocuments = 0
  let attachmentSizeBytes = 0

  for (const colName of COLLECTION_NAMES) {
    const collection = db[colName as keyof typeof db] as any
    if (!collection) {
      collections[colName] = []
      continue
    }
    const docs = await collection.find().exec()
    const plain: any[] = docs.map((d: any) => ({ ...d.toJSON() }))

    // For attachment collections, embed blob data as base64 dataUrl in backup
    if (ATTACHMENT_COLLECTIONS.has(colName)) {
      for (const doc of plain) {
        const blob = await blobStoreGet(doc.id)
        if (blob) {
          doc.dataUrl = await blobToDataUrl(blob)
          attachmentSizeBytes += blob.size
        }
      }
    }

    collections[colName] = plain
    totalDocuments += plain.length
  }

  return {
    metadata: {
      version: dbVersion,
      appVersion,
      timestamp: new Date().toISOString(),
      collections: [...COLLECTION_NAMES],
      totalDocuments,
      attachmentSizeBytes,
    },
    collections,
  }
}

// ---------------------------------------------------------------------------
// Download backup as JSON file
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file download for the backup JSON.
 * Returns the file size in bytes.
 */
export function downloadBackup(backup: BackupFile): number {
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = backup.metadata.timestamp.split('T')[0]
  a.href = url
  a.download = `shop-assist-backup-v${backup.metadata.version}-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  localStorage.setItem(LAST_BACKUP_META_KEY, JSON.stringify(backup.metadata))

  return blob.size
}

// ---------------------------------------------------------------------------
// Pick and parse a backup file from the user
// ---------------------------------------------------------------------------

export function pickAndParseBackupFile(): Promise<BackupFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('No file selected'))
        return
      }
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as BackupFile
        if (!parsed.metadata || !parsed.collections) {
          throw new Error('Invalid backup file: missing metadata or collections')
        }
        if (typeof parsed.metadata.version !== 'number') {
          throw new Error('Invalid backup file: version must be a number')
        }
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    }

    input.oncancel = () => reject(new Error('File selection cancelled'))
    input.click()
  })
}

// ---------------------------------------------------------------------------
// Restore backup into live RxDB instance
// ---------------------------------------------------------------------------

/**
 * Extracts a base64 dataUrl from a backup document into the blob store
 * and returns a sanitized doc without the large binary payload.
 */
async function extractBlobFromBackupDoc(doc: any): Promise<any> {
  if (doc.dataUrl && typeof doc.dataUrl === 'string' && doc.dataUrl.startsWith('data:')) {
    try {
      const blob = dataUrlToBlob(doc.dataUrl)
      await blobStorePut(doc.id, blob)
      addPendingUpload(doc.id)
    } catch (e) {
      console.error(`Failed to restore blob for ${doc.id}:`, e)
    }
  }
  const { dataUrl, ...rest } = doc
  return rest
}

export async function restoreBackupToDb(
  db: ShopAssistDatabase,
  backup: BackupFile,
): Promise<{ restored: number; skipped: string[] }> {
  let restored = 0
  const skipped: string[] = []

  for (const colName of COLLECTION_NAMES) {
    const collection = db[colName as keyof typeof db] as any
    if (!collection) {
      skipped.push(colName)
      continue
    }

    const docs = backup.collections[colName] ?? []

    // Remove all existing docs
    const existing = await collection.find().exec()
    await Promise.all(existing.map((d: any) => d.remove()))

    if (docs.length > 0) {
      try {
        let sanitized: any[]

        if (ATTACHMENT_COLLECTIONS.has(colName)) {
          sanitized = await Promise.all(
            docs.map((doc: any) => extractBlobFromBackupDoc(doc)),
          )
        } else {
          sanitized = docs as any[]
        }

        // Strip null values: RxDB JSON Schema does not accept null for typed fields
        sanitized = sanitized.map((doc: any) =>
          Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== null)),
        )

        const result = await collection.bulkInsert(sanitized)
        restored += result.success.length
        if (result.error.length > 0) {
          console.error(
            `Restore ${colName}: ${result.error.length} docs failed`,
            result.error[0],
          )
          skipped.push(`${colName}(${result.error.length} errors)`)
        }
      } catch (err) {
        console.error(`Failed to restore collection ${colName}:`, err)
        skipped.push(colName)
      }
    }
  }

  return { restored, skipped }
}

// ---------------------------------------------------------------------------
// Delete the entire RxDB IndexedDB database (for rollback)
// ---------------------------------------------------------------------------

export function deleteRxDatabase(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const dbName = await findDexieDbName()
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      // Another tab has the DB open — resolve anyway (will delete on close)
      console.warn('IndexedDB deletion blocked — another tab may have it open')
      resolve()
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getLastBackupMeta(): BackupMetadata | null {
  const stored = localStorage.getItem(LAST_BACKUP_META_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as BackupMetadata
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
