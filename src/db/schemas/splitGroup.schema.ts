import type { RxJsonSchema } from 'rxdb'
import type { SplitGroupDocument } from '../types'

/**
 * A "split group" scopes the who-owes-whom settlement math. It is deliberately
 * decoupled from expense categories: categories are an analytics dimension,
 * groups are a debt-settlement dimension (e.g. "Trip to Grodno", "Flatmates").
 */
export const splitGroupSchema: RxJsonSchema<SplitGroupDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 100 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name'],
}
