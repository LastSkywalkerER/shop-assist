import type { RxJsonSchema } from 'rxdb'
import type { ExpenseDocument } from '../types'

export const expenseSchema: RxJsonSchema<ExpenseDocument> = {
  version: 6,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    storeId: { type: 'string', maxLength: 36 },
    amount: { type: 'number', minimum: 0, maximum: 999999 },
    currency: { type: 'string', maxLength: 10 },
    date: { type: 'string', maxLength: 30 },
    categoryId: { type: 'string', maxLength: 36 },
    splitGroupId: { type: 'string', maxLength: 36 },
    groupName: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
    creatorName: { type: 'string', maxLength: 100 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'amount', 'currency', 'date', 'createdAt', 'updatedAt'],
  indexes: ['date'],
}
