import type { RxJsonSchema } from 'rxdb'
import type { StoreDocument } from '../types'

export const storeSchema: RxJsonSchema<StoreDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: ['market', 'store'], maxLength: 10 },
    address: { type: 'string', maxLength: 300 },
    chain: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name'],
}
