import type { RxJsonSchema } from 'rxdb'
import type { ReceiptDocument } from '../types'

export const receiptSchema: RxJsonSchema<ReceiptDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    expenseId: { type: 'string', maxLength: 36 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'expenseId', 'createdAt', 'updatedAt'],
  indexes: ['expenseId'],
}
