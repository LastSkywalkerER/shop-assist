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
} from './types'

export type ShopAssistCollections = {
  products: RxCollection<ProductDocument>
  stores: RxCollection<StoreDocument>
  purchases: RxCollection<PurchaseDocument>
  expenseCategories: RxCollection<ExpenseCategoryDocument>
  expenses: RxCollection<ExpenseDocument>
  receipts: RxCollection<ReceiptDocument>
  receiptItems: RxCollection<ReceiptItemDocument>
  expenseAttachments: RxCollection<ExpenseAttachmentDocument>
}

export type ShopAssistDatabase = RxDatabase<ShopAssistCollections>

let dbPromise: Promise<ShopAssistDatabase> | null = null

export function getDatabase(): Promise<ShopAssistDatabase> {
  if (!dbPromise) {
    dbPromise = createDb()
  }
  return dbPromise
}

async function createDb(): Promise<ShopAssistDatabase> {
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
        1: (oldDoc: any) => ({
          ...oldDoc,
          price: oldDoc.priceByn,
          currency: 'BYN',
          priceByn: undefined,
        }),
        2: (oldDoc: any) => ({
          ...oldDoc,
          manufacturer: undefined,
          packageVolume: undefined,
          variety: undefined,
        }),
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
      },
    },
    expenseAttachments: {
      schema: expenseAttachmentSchema,
      migrationStrategies: {},
    },
  })

  return db
}
