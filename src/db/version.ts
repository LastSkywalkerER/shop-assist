import { productSchema } from './schemas/product.schema'
import { storeSchema } from './schemas/store.schema'
import { purchaseSchema } from './schemas/purchase.schema'
import { expenseCategorySchema } from './schemas/expenseCategory.schema'
import { expenseSchema } from './schemas/expense.schema'
import { expenseParticipantSchema } from './schemas/expenseParticipant.schema'
import { expenseSettlementSchema } from './schemas/expenseSettlement.schema'
import { receiptSchema } from './schemas/receipt.schema'
import { receiptItemSchema } from './schemas/receiptItem.schema'
import { expenseAttachmentSchema } from './schemas/expenseAttachment.schema'
import { shoppingListItemSchema } from './schemas/shoppingListItem.schema'
import { purchaseAttachmentSchema } from './schemas/purchaseAttachment.schema'
import { currencyRateSchema } from './schemas/currencyRate.schema'
import { splitGroupSchema } from './schemas/splitGroup.schema'
import { superCategorySchema } from './schemas/superCategory.schema'
import { expenseImportIgnoreSchema } from './schemas/expenseImportIgnore.schema'

/**
 * Returns the current DB version (max version across all schemas).
 */
export function getDatabaseVersion(): number {
  const schemas = [
    productSchema,
    storeSchema,
    purchaseSchema,
    expenseCategorySchema,
    expenseSchema,
    expenseParticipantSchema,
    expenseSettlementSchema,
    receiptSchema,
    receiptItemSchema,
    expenseAttachmentSchema,
    shoppingListItemSchema,
    purchaseAttachmentSchema,
    currencyRateSchema,
    splitGroupSchema,
    superCategorySchema,
    expenseImportIgnoreSchema,
  ]

  const maxVersion = Math.max(...schemas.map((schema) => schema.version))
  return maxVersion
}

const DB_VERSION_KEY = 'db_version'

/**
 * Returns the DB version stored from the last successful initialization.
 * Returns null if no version has been stored (fresh install).
 */
export function getStoredDbVersion(): number | null {
  const stored = localStorage.getItem(DB_VERSION_KEY)
  if (stored === null) return null
  const parsed = parseInt(stored, 10)
  return isNaN(parsed) ? null : parsed
}

/**
 * Persists the current DB version after successful initialization.
 */
export function setStoredDbVersion(version: number): void {
  localStorage.setItem(DB_VERSION_KEY, String(version))
}
