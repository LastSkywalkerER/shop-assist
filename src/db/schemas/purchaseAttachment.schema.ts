import type { RxJsonSchema } from 'rxdb'
import type { PurchaseAttachmentDocument } from '../types'

export const purchaseAttachmentSchema: RxJsonSchema<PurchaseAttachmentDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    purchaseId: { type: 'string', maxLength: 36 },
    dataUrl: { type: 'string', maxLength: 10000000 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'purchaseId', 'dataUrl', 'createdAt', 'updatedAt'],
  indexes: ['purchaseId'],
  additionalProperties: false,
}
