import { productSchema } from './schemas/product.schema'
import { storeSchema } from './schemas/store.schema'
import { purchaseSchema } from './schemas/purchase.schema'
import { expenseCategorySchema } from './schemas/expenseCategory.schema'
import { expenseSchema } from './schemas/expense.schema'
import { receiptSchema } from './schemas/receipt.schema'
import { receiptItemSchema } from './schemas/receiptItem.schema'
import { expenseAttachmentSchema } from './schemas/expenseAttachment.schema'

/**
 * Получить текущую версию БД (максимальная версия среди всех схем)
 */
export function getDatabaseVersion(): number {
  const schemas = [
    productSchema,
    storeSchema,
    purchaseSchema,
    expenseCategorySchema,
    expenseSchema,
    receiptSchema,
    receiptItemSchema,
    expenseAttachmentSchema,
  ]

  // Найти максимальную версию
  const maxVersion = Math.max(...schemas.map((schema) => schema.version))
  return maxVersion
}
