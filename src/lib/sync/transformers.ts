export interface SupabaseRow {
  id: string
  room_id: string
  created_at: string
  updated_at: string
  _deleted: boolean
  [key: string]: any
}

/**
 * Конвертация camelCase в snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * Конвертация snake_case в camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Конвертация RxDB документа в формат Supabase
 */
export function transformRxDBToSupabase(
  doc: any,
  roomId: string
): SupabaseRow {
  const result: Record<string, any> = {
    id: doc.id,
    room_id: roomId,
    _deleted: doc._deleted || false,
  }

  // Конвертировать все поля из camelCase в snake_case
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'id' || key === '_deleted' || value === undefined) continue

    const snakeKey = camelToSnake(key)
    result[snakeKey] = value
  }

  return result as SupabaseRow
}

/**
 * Конвертация Supabase row в формат RxDB
 */
export function transformSupabaseToRxDB(row: SupabaseRow): any {
  const result: Record<string, any> = {
    _deleted: row._deleted,
  }

  // Конвертировать все поля из snake_case в camelCase
  for (const [key, value] of Object.entries(row)) {
    if (key === 'room_id' || key === '_deleted') continue

    const camelKey = snakeToCamel(key)
    result[camelKey] = value
  }

  return result
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
