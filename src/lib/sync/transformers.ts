import type { RxDocument } from 'rxdb'

export interface SupabaseRow {
  id: string
  room_id: string
  created_at: string
  updated_at: string
  _deleted: boolean
  [key: string]: any
}

/**
 * Конвертация RxDB документа в формат Supabase
 */
export function transformRxDBToSupabase(
  doc: RxDocument,
  roomId: string
): SupabaseRow {
  const data = doc.toJSON()

  return {
    ...data,
    room_id: roomId,
    // RxDB использует ISO string, Supabase timestamptz - совместимо
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    _deleted: doc._deleted || false,
  }
}

/**
 * Конвертация Supabase row в формат RxDB
 */
export function transformSupabaseToRxDB(row: SupabaseRow): any {
  const { room_id, created_at, updated_at, _deleted, ...rest } = row

  return {
    ...rest,
    createdAt: created_at,
    updatedAt: updated_at,
    _deleted,
  }
}

/**
 * Преобразование имени коллекции в имя таблицы sync
 */
export function getTableName(collectionName: string): string {
  // products -> products_sync
  // expenseCategories -> expense_categories_sync
  return collectionName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '') + '_sync'
}
