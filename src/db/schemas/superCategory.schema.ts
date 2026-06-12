import type { RxJsonSchema } from 'rxdb'
import type { SuperCategoryDocument } from '../types'

/**
 * A "super category" groups regular expense categories into a coarser
 * analytics dimension (e.g. "Еда" = «Продукты» + «Кафе»). Analytics defaults
 * to the super-category breakdown; categories outside any super category are
 * shown under «Другое».
 */
export const superCategorySchema: RxJsonSchema<SuperCategoryDocument> = {
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
