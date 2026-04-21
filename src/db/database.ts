import { createRxDatabase, addRxPlugin, type RxStorage } from 'rxdb/plugins/core'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema'
import { productSchema } from './schemas/product.schema'
import { storeSchema } from './schemas/store.schema'
import { purchaseSchema } from './schemas/purchase.schema'
import { expenseCategorySchema } from './schemas/expenseCategory.schema'
import { expenseSchema } from './schemas/expense.schema'
import { receiptSchema } from './schemas/receipt.schema'
import { receiptItemSchema } from './schemas/receiptItem.schema'
import { expenseAttachmentSchema } from './schemas/expenseAttachment.schema'
import { shoppingListItemSchema } from './schemas/shoppingListItem.schema'
import { purchaseAttachmentSchema } from './schemas/purchaseAttachment.schema'
import { currencyRateSchema } from './schemas/currencyRate.schema'
import type { RxDatabase, RxCollection } from 'rxdb'
import type {
  ProductDocument,
  StoreDocument,
  PurchaseDocument,
  ExpenseCategoryDocument,
  ExpenseDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ShoppingListItemDocument,
  PurchaseAttachmentDocument,
  CurrencyRateDocument,
} from './types'
import { getDatabaseVersion, getStoredDbVersion, setStoredDbVersion } from './version'
import { readRawIndexedDB, buildBackupFromRawData, downloadBackup } from './backup'
import { blobStorePut, addPendingUpload, dataUrlToBlob, closeBlobStore } from './blobStore'
import packageJson from '../../package.json'

export type ShopAssistCollections = {
  products: RxCollection<ProductDocument>
  stores: RxCollection<StoreDocument>
  purchases: RxCollection<PurchaseDocument>
  expenseCategories: RxCollection<ExpenseCategoryDocument>
  expenses: RxCollection<ExpenseDocument>
  receipts: RxCollection<ReceiptDocument>
  receiptItems: RxCollection<ReceiptItemDocument>
  expenseAttachments: RxCollection<ExpenseAttachmentDocument>
  shoppingListItems: RxCollection<ShoppingListItemDocument>
  purchaseAttachments: RxCollection<PurchaseAttachmentDocument>
  currencyRates: RxCollection<CurrencyRateDocument>
}

export type ShopAssistDatabase = RxDatabase<ShopAssistCollections>

let dbPromise: Promise<ShopAssistDatabase> | null = null

export function getDatabase(): Promise<ShopAssistDatabase> {
  if (!dbPromise) {
    dbPromise = createDb()
  }
  return dbPromise
}

export function resetDatabase(): void {
  closeBlobStore()
  dbPromise = null
}

async function createDb(): Promise<ShopAssistDatabase> {
  // Pre-migration backup: if DB version changed since last run, export data before migration
  const currentVersion = getDatabaseVersion()
  const storedVersion = getStoredDbVersion()
  if (storedVersion !== null && storedVersion !== currentVersion) {
    try {
      const raw = await readRawIndexedDB()
      const backup = buildBackupFromRawData(raw, packageJson.version, storedVersion)
      downloadBackup(backup)
      console.log(`Pre-migration backup created: v${storedVersion} → v${currentVersion}`)
    } catch (err) {
      // Never block migration due to backup failure
      console.error('Pre-migration backup failed (non-fatal):', err)
    }
  }

  if (import.meta.env.DEV) {
    const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode')
    addRxPlugin(RxDBDevModePlugin)
  }

  addRxPlugin(RxDBMigrationSchemaPlugin)

  let storage: RxStorage<any, any> = getRxStorageDexie()

  if (import.meta.env.DEV) {
    const { wrappedValidateAjvStorage } = await import('rxdb/plugins/validate-ajv')
    storage = wrappedValidateAjvStorage({ storage })
  }

  const db = await createRxDatabase<ShopAssistCollections>({
    name: 'shopassist',
    storage,
  })

  await db.addCollections({
    products: {
      schema: productSchema,
      migrationStrategies: {
        1: (oldDoc: any) => {
          const doc = { ...oldDoc }
          delete doc.manufacturer
          delete doc.packageVolume
          return doc
        },
      },
    },
    stores: {
      schema: storeSchema,
      migrationStrategies: {},
    },
    purchases: {
      schema: purchaseSchema,
      migrationStrategies: {
        1: (oldDoc: any) => {
          const { priceByn, ...rest } = oldDoc
          return { ...rest, price: priceByn, currency: 'BYN' }
        },
        2: (oldDoc: any) => {
          const result: Record<string, any> = {
            id: oldDoc.id,
            productId: oldDoc.productId,
            storeId: oldDoc.storeId,
            price: oldDoc.price,
            currency: oldDoc.currency || 'BYN',
            purchaseDate: oldDoc.purchaseDate,
            createdAt: oldDoc.createdAt,
            updatedAt: oldDoc.updatedAt,
          }
          if (oldDoc.qualityRating != null) result.qualityRating = oldDoc.qualityRating
          if (oldDoc.notes != null) result.notes = oldDoc.notes
          return result
        },
        3: (oldDoc: any) => oldDoc,
        4: (oldDoc: any) => oldDoc,
        5: (oldDoc: any) => {
          const doc = { ...oldDoc }
          if (doc.sourceUrl) {
            const meta: Record<string, string> = { url: doc.sourceUrl }
            if (doc.sourceTitle) meta.title = doc.sourceTitle
            if (doc.sourceDescription) meta.description = doc.sourceDescription
            doc.link = JSON.stringify(meta)
          }
          delete doc.sourceUrl
          delete doc.sourceTitle
          delete doc.sourceDescription
          return doc
        },
      },
    },
    expenseCategories: {
      schema: expenseCategorySchema,
      migrationStrategies: {},
    },
    expenses: {
      schema: expenseSchema,
      migrationStrategies: {
        1: (oldDoc: any) => ({
          ...oldDoc,
          notes: undefined,
        }),
        2: (oldDoc: any) => ({
          ...oldDoc,
          currency: 'BYN',
        }),
        3: (oldDoc: any) => oldDoc,
        4: (oldDoc: any) => oldDoc,
      },
    },
    receipts: {
      schema: receiptSchema,
      migrationStrategies: {},
    },
    receiptItems: {
      schema: receiptItemSchema,
      migrationStrategies: {
        1: (oldDoc: any) => {
          return {
            ...oldDoc,
            manufacturer: undefined,
            packageVolume: undefined,
            category: undefined,
          }
        },
        2: (oldDoc: any) => ({
          ...oldDoc,
          qualityRating: undefined,
          notes: undefined,
        }),
        3: (oldDoc: any) => ({
          ...oldDoc,
          currency: 'BYN',
        }),
        4: (oldDoc: any) => ({
          ...oldDoc,
          variety: undefined,
        }),
        5: (oldDoc: any) => oldDoc,
      },
    },
    expenseAttachments: {
      schema: expenseAttachmentSchema,
      migrationStrategies: {
        1: async (oldDoc: any) => {
          if (oldDoc.dataUrl && oldDoc.dataUrl.startsWith('data:')) {
            try {
              const blob = dataUrlToBlob(oldDoc.dataUrl)
              await blobStorePut(oldDoc.id, blob)
              addPendingUpload(oldDoc.id)
            } catch (e) {
              console.error('Failed to migrate expense attachment blob:', e)
            }
          }
          const { dataUrl, ...rest } = oldDoc
          return rest
        },
      },
    },
  })

  // New collections added in a separate call: Dexie must add new object stores
  // (requiring a version upgrade) only after existing migrations have finished.
  await db.addCollections({
    shoppingListItems: {
      schema: shoppingListItemSchema,
      migrationStrategies: {
        1: (oldDoc: any) => oldDoc,
        2: (oldDoc: any) => oldDoc,
        3: (oldDoc: any) => {
          const doc = { ...oldDoc }
          if (doc.sourceUrl) {
            const meta: Record<string, string> = { url: doc.sourceUrl }
            if (doc.sourceTitle) meta.title = doc.sourceTitle
            doc.link = JSON.stringify(meta)
          }
          delete doc.sourceUrl
          delete doc.sourceTitle
          return doc
        },
        4: (oldDoc: any) => oldDoc,
      },
    },
    purchaseAttachments: {
      schema: purchaseAttachmentSchema,
      migrationStrategies: {
        1: async (oldDoc: any) => {
          let mimeType = 'image/jpeg'
          let size = 0
          if (oldDoc.dataUrl && oldDoc.dataUrl.startsWith('data:')) {
            try {
              const blob = dataUrlToBlob(oldDoc.dataUrl)
              mimeType = blob.type || 'image/jpeg'
              size = blob.size
              await blobStorePut(oldDoc.id, blob)
              addPendingUpload(oldDoc.id)
            } catch (e) {
              console.error('Failed to migrate purchase attachment blob:', e)
            }
          }
          return {
            id: oldDoc.id,
            purchaseId: oldDoc.purchaseId,
            mimeType,
            size,
            createdAt: oldDoc.createdAt,
            updatedAt: oldDoc.updatedAt,
          }
        },
      },
    },
  })

  // Currency rates — global collection (not room-scoped), pull-only from Supabase.
  // Added in a separate addCollections call to avoid Dexie object-store version conflicts.
  await db.addCollections({
    currencyRates: {
      schema: currencyRateSchema,
      migrationStrategies: {},
    },
  })

  setStoredDbVersion(currentVersion)
  return db
}
