import type { RxJsonSchema } from 'rxdb'
import type { ProductDocument } from '../types'

export const productSchema: RxJsonSchema<ProductDocument> = {
  version: 2,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    barcode: { type: 'string', maxLength: 50 },
    category: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name', 'createdAt', 'barcode'],
}
