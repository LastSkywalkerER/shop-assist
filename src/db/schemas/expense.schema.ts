import type { RxJsonSchema } from 'rxdb'
import type { ExpenseDocument } from '../types'

export const expenseSchema: RxJsonSchema<ExpenseDocument> = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    storeId: { type: 'string', maxLength: 36 },
    amount: { type: 'number', minimum: 0, maximum: 999999, multipleOf: 0.01 },
    date: { type: 'string', maxLength: 30 },
    categoryId: { type: 'string', maxLength: 36 },
    notes: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'amount', 'date', 'createdAt', 'updatedAt'],
  indexes: ['date'],
}
