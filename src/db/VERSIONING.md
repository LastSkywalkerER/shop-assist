# Версионирование БД и приложения

## Версия приложения

### Откуда берется?
Из [package.json](../../package.json) поле `version`.

### Как изменить?
```json
{
  "version": "1.0.0"  // Изменить здесь
}
```

### Семантическое версионирование (SemVer)
```
MAJOR.MINOR.PATCH

1.0.0 → 1.0.1  (PATCH)  - Исправление багов
1.0.1 → 1.1.0  (MINOR)  - Новая функциональность (обратно совместимая)
1.1.0 → 2.0.0  (MAJOR)  - Критические изменения (breaking changes)
```

### Когда увеличивать?
- **PATCH** (0.0.X): Исправили баг, мелкие правки UI
- **MINOR** (0.X.0): Добавили новую фичу (например, новый тип продукта)
- **MAJOR** (X.0.0): Изменили структуру данных (миграция БД)

---

## Версия БД

### Откуда берется?
Из RxDB schemas - **максимальная версия** среди всех коллекций.

Файл: [version.ts](./version.ts)

```typescript
// Автоматически находит максимальную версию
export function getDatabaseVersion(): number {
  const schemas = [
    productSchema,      // version: 0
    storeSchema,        // version: 0
    purchaseSchema,     // version: 0
    // ...
    receiptItemSchema,  // version: 1  ← Максимум!
  ]

  return Math.max(...schemas.map(s => s.version))  // Вернет 1
}
```

### Текущие версии схем

| Schema | Version | Файл |
|--------|---------|------|
| products | 0 | [product.schema.ts](./schemas/product.schema.ts) |
| stores | 0 | [store.schema.ts](./schemas/store.schema.ts) |
| purchases | 0 | [purchase.schema.ts](./schemas/purchase.schema.ts) |
| expenseCategories | 0 | [expenseCategory.schema.ts](./schemas/expenseCategory.schema.ts) |
| expenses | 0 | [expense.schema.ts](./schemas/expense.schema.ts) |
| receipts | 0 | [receipt.schema.ts](./schemas/receipt.schema.ts) |
| **receiptItems** | **1** ✨ | [receiptItem.schema.ts](./schemas/receiptItem.schema.ts) |
| expenseAttachments | 0 | [expenseAttachment.schema.ts](./schemas/expenseAttachment.schema.ts) |

**Версия БД:** `1` (максимум из всех)

---

## Как изменить версию БД?

### 1. Обновить schema

Пример: добавим поле `color` в продукты.

**Файл:** `schemas/product.schema.ts`

```typescript
export const productSchema: RxJsonSchema<ProductDocument> = {
  version: 1,  // ← Было 0, стало 1
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 36 },
    name: { type: 'string', maxLength: 200 },
    color: { type: 'string', maxLength: 50 },  // ← Новое поле!
    // ...
  },
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  indexes: ['name', 'createdAt'],
}
```

### 2. Добавить стратегию миграции

В `database.ts`:

```typescript
await db.addCollections({
  products: {
    schema: productSchema,
    migrationStrategies: {
      // Миграция с версии 0 на 1
      1: (oldDoc: any) => {
        return {
          ...oldDoc,
          color: undefined,  // Новое поле, пока пустое
        }
      },
    },
  },
  // ...
})
```

### 3. Автоматическое увеличение версии БД

После изменения:
- `productSchema.version` = 1
- Другие schemas = 0
- `getDatabaseVersion()` вернет **1** (максимум)

✅ **Версия БД автоматически обновится на 1!**

---

## Пример: Добавление нового поля

### Сценарий
Хотим добавить поле `expirationDate` в продукты.

### Шаг 1: Обновить schema

```typescript
// schemas/product.schema.ts
export const productSchema: RxJsonSchema<ProductDocument> = {
  version: 2,  // ← Увеличили с 1 на 2
  // ...
  properties: {
    // ...
    expirationDate: { type: 'string', maxLength: 30 },  // ← Новое!
  },
}
```

### Шаг 2: Обновить TypeScript типы

```typescript
// types.ts
export interface ProductDocument {
  id: string
  name: string
  expirationDate?: string  // ← Новое!
  // ...
}
```

### Шаг 3: Добавить миграцию

```typescript
// database.ts
migrationStrategies: {
  1: (oldDoc) => ({ ...oldDoc, color: undefined }),
  2: (oldDoc) => ({ ...oldDoc, expirationDate: undefined }),  // ← Новая!
}
```

### Шаг 4: Результат

- Версия БД стала **2**
- Старые документы автоматически мигрируют
- Новое поле доступно в UI

---

## Автоматическое отображение в UI

В настройках приложения:

```tsx
// components/settings/AppInfoSection.tsx
const appVersion = packageJson.version      // "1.0.0"
const dbVersion = getDatabaseVersion()      // 2
```

Отображается:
```
Версия приложения: 1.0.0
Версия БД: 2
```

**✨ Полностью автоматически!**

---

## Что происходит при миграции?

```
User открывает приложение
  ↓
RxDB проверяет версии схем
  ↓
Версия в схеме > версия в БД?
  ↓
Да → Запустить миграцию
  ↓
migrationStrategies[новая_версия](oldDoc)
  ↓
Обновить документ
  ↓
✅ Готово!
```

---

## Best Practices

### ✅ DO:
- Увеличивать версию при **любом** изменении schema
- Писать миграции для **каждой** новой версии
- Тестировать миграции на старых данных
- Делать поля опциональными (с `?`) при добавлении

### ❌ DON'T:
- Удалять старые миграции
- Менять schema без увеличения версии
- Делать breaking changes без миграции
- Забывать обновить TypeScript типы

---

## Примеры миграций

### Добавление поля
```typescript
1: (oldDoc) => ({
  ...oldDoc,
  newField: undefined  // или defaultValue
})
```

### Переименование поля
```typescript
1: (oldDoc) => ({
  ...oldDoc,
  newName: oldDoc.oldName,
  oldName: undefined
})
```

### Изменение типа
```typescript
1: (oldDoc) => ({
  ...oldDoc,
  price: parseFloat(oldDoc.price)  // string → number
})
```

### Удаление поля
```typescript
1: (oldDoc) => {
  const { obsoleteField, ...rest } = oldDoc
  return rest
}
```

---

## FAQ

**Q: Как узнать текущую версию БД?**
A: Открыть `/settings` → "Версия БД"

**Q: Что если забыл увеличить версию?**
A: RxDB выдаст ошибку при загрузке. Нужно увеличить версию и перезагрузить.

**Q: Можно ли откатить версию назад?**
A: Нет. Только вперед. Версии монотонно растут.

**Q: Как тестировать миграции?**
A: Создать тестовые данные старой версии, обновить schema, проверить что данные мигрировали корректно.

**Q: Влияет ли версия БД на синхронизацию?**
A: Да. Все устройства должны иметь совместимые версии schemas для корректной синхронизации.

---

## Итог

✅ **Версия приложения** - из `package.json` (ручное управление)
✅ **Версия БД** - автоматически из максимальной версии schema
✅ **Отображение** - автоматически в настройках
✅ **Миграции** - запускаются автоматически при обновлении schema
