import type { RxJsonSchema } from 'rxdb'
import type { ExpenseImportIgnoreDocument } from '../types'

/**
 * A name the user chose to ignore when importing an expense list (bulk upload).
 * Rows whose source name is (almost) identical to a stored entry are hidden from
 * the reconcile list and skipped on future recognitions. Room-scoped and synced
 * so the whole room shares one ignore list. Matching is done at runtime in
 * `src/lib/ai/ignoreList.ts` against a normalized form of `name`.
 */
export const expenseImportIgnoreSchema: RxJsonSchema<ExpenseImportIgnoreDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name'],
}
