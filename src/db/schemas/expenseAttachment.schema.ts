import type { RxJsonSchema } from 'rxdb'
import type { ExpenseAttachmentDocument } from '../types'

export const expenseAttachmentSchema: RxJsonSchema<ExpenseAttachmentDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    receiptId: { type: 'string', maxLength: 36 },
    fileName: { type: 'string', maxLength: 200 },
    mimeType: { type: 'string', maxLength: 100 },
    dataUrl: { type: 'string', maxLength: 10000000 },
    size: { type: 'number', minimum: 0, maximum: 10000000 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'receiptId', 'fileName', 'mimeType', 'dataUrl', 'size', 'createdAt', 'updatedAt'],
  indexes: ['receiptId'],
}
