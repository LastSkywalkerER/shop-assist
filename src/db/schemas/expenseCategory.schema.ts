import type { RxJsonSchema } from 'rxdb'
import type { ExpenseCategoryDocument } from '../types'

export const expenseCategorySchema: RxJsonSchema<ExpenseCategoryDocument> = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 100 },
    superCategoryId: { type: 'string', maxLength: 36 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name'],
}
