import type { RxJsonSchema } from 'rxdb'
import type { PurchaseDocument } from '../types'

export const purchaseSchema: RxJsonSchema<PurchaseDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    productId: { type: 'string', maxLength: 36 },
    storeId: { type: 'string', maxLength: 36 },
    priceByn: { type: 'number', minimum: 0, maximum: 99999, multipleOf: 0.01 },
    qualityRating: { type: 'integer', minimum: 1, maximum: 5 },
    purchaseDate: { type: 'string', maxLength: 30 },
    notes: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'productId', 'storeId', 'priceByn', 'purchaseDate', 'createdAt', 'updatedAt'],
  indexes: ['productId', 'storeId', 'purchaseDate'],
}
