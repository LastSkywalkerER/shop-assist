import type { RxJsonSchema } from 'rxdb'
import type { ExpenseParticipantDocument } from '../types'

/**
 * A participant attached to an expense who shares part of its cost.
 *
 * The main payer of an expense is NOT stored here — it stays on
 * `expense.creatorName`. Participants describe how the bill is divided:
 *  - shareMode 'equal'  — split the remainder equally among all 'equal' participants
 *  - shareMode 'amount' — a fixed sum (`shareAmount`)
 *  - shareMode 'items'  — the sum of the selected receipt line-items (`itemIds`)
 *
 * `settledAmount` is how much this person has already paid back toward the
 * expense (reduces what they still owe the payer).
 */
export const expenseParticipantSchema: RxJsonSchema<ExpenseParticipantDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    expenseId: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 100 },
    shareMode: { type: 'string', maxLength: 10, enum: ['equal', 'amount', 'items'] },
    shareAmount: { type: 'number', minimum: 0, maximum: 999999 },
    itemIds: {
      type: 'array',
      items: { type: 'string', maxLength: 36 },
    },
    settledAmount: { type: 'number', minimum: 0, maximum: 999999 },
    createdAt: { type: 'string', maxLength: 30 },
    updatedAt: { type: 'string', maxLength: 30 },
  },
  required: ['id', 'expenseId', 'name', 'shareMode', 'createdAt', 'updatedAt'],
  indexes: ['expenseId'],
}
