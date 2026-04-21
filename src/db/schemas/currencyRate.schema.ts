import type { RxJsonSchema } from 'rxdb'
import type { CurrencyRateDocument } from '../types'

export const currencyRateSchema: RxJsonSchema<CurrencyRateDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    currency: { type: 'string', maxLength: 3 },
    date: { type: 'string', maxLength: 10 },
    rate: { type: 'number' },
    scale: { type: 'integer' },
    source: { type: 'string', maxLength: 20 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'currency', 'date', 'rate', 'scale', 'createdAt', 'updatedAt'],
  indexes: ['date', ['currency', 'date']],
}
