import type { RxJsonSchema } from 'rxdb'
import type { ReceiptItemDocument } from '../types'

export const receiptItemSchema: RxJsonSchema<ReceiptItemDocument> = {
  version: 2,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    receiptId: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    amount: { type: 'number', minimum: 0, maximum: 99999, multipleOf: 0.01 },
    manufacturer: { type: 'string', maxLength: 200 },
    packageVolume: { type: 'string', maxLength: 50 },
    category: { type: 'string', maxLength: 100 },
    qualityRating: { type: 'number', minimum: 1, maximum: 5 },
    notes: { type: 'string', maxLength: 500 },
    convertedToPurchaseId: { type: 'string', maxLength: 36 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'receiptId', 'name', 'amount', 'createdAt', 'updatedAt'],
  indexes: ['receiptId'],
}
