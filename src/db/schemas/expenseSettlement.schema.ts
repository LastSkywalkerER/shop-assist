import type { RxJsonSchema } from 'rxdb'
import type { ExpenseSettlementDocument } from '../types'

/**
 * A recorded repayment within a settlement scope, independent of any single
 * expense.
 *
 * Used on the settlement screen to mark that one person paid another back
 * toward their shared balance. Amounts are stored in the base currency (BYN),
 * the same unit the settlement summary is computed in.
 *
 * Note on `categoryId`: settlements were originally scoped by expense
 * category; since split groups took over the who-owes-whom math, new records
 * store a split group id in this field. The name is kept as-is because the
 * synced column may not be renamed (additive-only schema rule). Legacy
 * category-scoped rows are preserved but no longer surfaced in the group UI.
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
