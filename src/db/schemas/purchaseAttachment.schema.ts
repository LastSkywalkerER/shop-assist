import type { RxJsonSchema } from 'rxdb'
import type { PurchaseAttachmentDocument } from '../types'

export const purchaseAttachmentSchema: RxJsonSchema<PurchaseAttachmentDocument> = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    purchaseId: { type: 'string', maxLength: 36 },
    fileName: { type: 'string', maxLength: 200 },
    mimeType: { type: 'string', maxLength: 100 },
    size: { type: 'number', minimum: 0, maximum: 10000000 },
    storagePath: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'purchaseId', 'createdAt', 'updatedAt'],
  indexes: ['purchaseId'],
  additionalProperties: false,
}
