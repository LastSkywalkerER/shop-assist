import type { RxJsonSchema } from 'rxdb'
import type { ShoppingListItemDocument } from '../types'

export const shoppingListItemSchema: RxJsonSchema<ShoppingListItemDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    done: { type: 'boolean' },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'done', 'createdAt', 'updatedAt'],
  indexes: ['createdAt'],
  additionalProperties: false,
}
