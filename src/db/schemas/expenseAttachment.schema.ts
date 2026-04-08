import type { RxJsonSchema } from 'rxdb'
import type { ExpenseAttachmentDocument } from '../types'

export const expenseAttachmentSchema: RxJsonSchema<ExpenseAttachmentDocument> = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    receiptId: { type: 'string', maxLength: 36 },
    fileName: { type: 'string', maxLength: 200 },
    mimeType: { type: 'string', maxLength: 100 },
    size: { type: 'number', minimum: 0, maximum: 10000000 },
    storagePath: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'receiptId', 'fileName', 'mimeType', 'size', 'createdAt', 'updatedAt'],
  indexes: ['receiptId'],
}
