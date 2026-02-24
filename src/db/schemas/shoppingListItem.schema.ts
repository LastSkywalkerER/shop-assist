import type { RxJsonSchema } from 'rxdb'
import type { ShoppingListItemDocument } from '../types'

export const shoppingListItemSchema: RxJsonSchema<ShoppingListItemDocument> = {
  version: 3,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    done: { type: 'boolean' },
    link: { type: 'string', maxLength: 5000 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'done', 'createdAt', 'updatedAt'],
  indexes: ['createdAt'],
  additionalProperties: false,
}
