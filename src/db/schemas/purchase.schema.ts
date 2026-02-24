import type { RxJsonSchema } from 'rxdb'
import type { PurchaseDocument } from '../types'

export const purchaseSchema: RxJsonSchema<PurchaseDocument> = {
  version: 5,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    productId: { type: 'string', maxLength: 36 },
    storeId: { type: 'string', maxLength: 36 },
    price: { type: 'number', minimum: 0, maximum: 99999 },
    currency: { type: 'string', maxLength: 10 },
    qualityRating: { type: 'integer', minimum: 1, maximum: 5 },
    purchaseDate: { type: 'string', maxLength: 30 },
    manufacturer: { type: 'string', maxLength: 200 },
    packageVolume: { type: 'string', maxLength: 50 },
    variety: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
    link: { type: 'string', maxLength: 5000 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'productId', 'storeId', 'price', 'currency', 'purchaseDate', 'createdAt', 'updatedAt'],
  indexes: ['productId', 'storeId', 'purchaseDate'],
}
