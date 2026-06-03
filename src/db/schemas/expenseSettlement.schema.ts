import type { RxJsonSchema } from 'rxdb'
import type { ExpenseSettlementDocument } from '../types'

/**
 * A recorded repayment within a category, independent of any single expense.
 *
 * Used on the category settlement screen to mark that one person paid another
 * back toward their shared balance. Amounts are stored in the base currency
 * (BYN), the same unit the settlement summary is computed in.
 */
export const expenseSettlementSchema: RxJsonSchema<ExpenseSettlementDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    categoryId: { type: 'string', maxLength: 36 },
    fromName: { type: 'string', maxLength: 100 },
    toName: { type: 'string', maxLength: 100 },
    amount: { type: 'number', minimum: 0, maximum: 999999 },
    currency: { type: 'string', maxLength: 10 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'categoryId', 'fromName', 'toName', 'amount', 'createdAt', 'updatedAt'],
  indexes: ['categoryId'],
}
