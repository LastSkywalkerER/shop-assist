# Supabase Configuration & Deployment

Этот каталог содержит все необходимые файлы для развертывания backend Shop Assist в новом проекте Supabase.

## Структура

```
supabase/
├── migrations/                # SQL миграции для PostgreSQL
│   ├── 001_create_users_and_rooms.sql
│   ├── 002_create_sync_tables.sql
│   ├── 003_configure_rls_policies.sql
│   └── 004_enable_realtime.sql
├── functions/                 # Edge Functions (Deno)
│   └── telegram-auth/
│       └── index.ts
└── README.md                  # Эта инструкция
```

## Предварительные требования

1. **Supabase проект** - создайте новый проект на [supabase.com](https://supabase.com)
2. **Supabase CLI** - установите глобально:
   ```bash
   npm install -g supabase
   ```
3. **Telegram Bot** - создайте бота через [@BotFather](https://t.me/botfather) и получите токен

## Шаг 1: Инициализация проекта

```bash
# Перейдите в корень репозитория
cd /path/to/shop-assist

# Свяжите локальный проект с Supabase проектом
supabase link --project-ref YOUR_PROJECT_REF

# YOUR_PROJECT_REF можно найти в URL вашего проекта:
# https://app.supabase.com/project/YOUR_PROJECT_REF
```

## Шаг 2: Применение миграций

Миграции применяются в строгом порядке:

```bash
# 1. Создать таблицы пользователей и комнат
supabase db push --db-url postgresql://postgres:[YOUR_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres --file supabase/migrations/001_create_users_and_rooms.sql

# 2. Создать sync таблицы для RxDB репликации
supabase db push --db-url postgresql://postgres:[YOUR_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres --file supabase/migrations/002_create_sync_tables.sql

# 3. Настроить RLS политики безопасности
supabase db push --db-url postgresql://postgres:[YOUR_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres --file supabase/migrations/003_configure_rls_policies.sql

# 4. Включить Realtime для синхронизации
supabase db push --db-url postgresql://postgres:[YOUR_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres --file supabase/migrations/004_enable_realtime.sql
```

**Альтернативный способ** (через MCP Supabase tools в Claude Code):

```
mcp__supabase__apply_migration с параметрами:
- name: create_users_and_rooms
- query: <содержимое 001_create_users_and_rooms.sql>
... повторить для всех 4 миграций
```

## Шаг 3: Развертывание Edge Function

Edge Function `telegram-auth` обрабатывает авторизацию через Telegram.

```bash
# Развернуть функцию
supabase functions deploy telegram-auth --project-ref YOUR_PROJECT_REF

# Установить секреты (environment variables)
supabase secrets set BOT_TOKEN=your_telegram_bot_token --project-ref YOUR_PROJECT_REF
```

**Важно:** `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` устанавливаются автоматически.

## Шаг 4: Настройка Telegram Bot

1. Откройте [@BotFather](https://t.me/botfather)
2. Выберите вашего бота
3. Настройте Web App:
   ```
   /mybots → [Ваш бот] → Bot Settings → Menu Button → Edit menu button URL
   ```
4. Укажите URL вашего приложения (например, `https://yourdomain.com`)
5. Настройте Domain для Login Widget:
   ```
   /setdomain → [Ваш бот] → yourdomain.com
   ```

## Шаг 5: Настройка переменных окружения

В корне проекта создайте файл `.env.local`:

```env
# Supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_publishable_key

# Telegram (для локальной разработки)
BOT_TOKEN=your_telegram_bot_token
```

**Где найти ключи:**
- Project Settings → API → Project URL (VITE_SUPABASE_URL)
- Project Settings → API → Project API keys → `anon` `public` (VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY)
- [@BotFather](https://t.me/botfather) → Ваш бот → API Token (BOT_TOKEN)

## Шаг 6: Проверка развертывания

### Проверка миграций

```bash
# Список всех таблиц
supabase db diff --use-migra --linked
```

Ожидаемые таблицы:
- `users`, `rooms`, `room_memberships`
- `products_sync`, `stores_sync`, `purchases_sync`
- `expense_categories_sync`, `expenses_sync`, `receipts_sync`
- `receipt_items_sync`, `expense_attachments_sync`

### Проверка Edge Function

```bash
# Проверить статус функции
supabase functions list --project-ref YOUR_PROJECT_REF

# Тестовый запрос (замените данные на реальные)
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-auth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "id": 123456789,
    "first_name": "Test",
    "username": "testuser",
    "auth_date": 1234567890,
    "hash": "test_hash"
  }'
```

### Проверка RLS политик

В Supabase Dashboard → SQL Editor:

```sql
-- Проверить что RLS включен
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE '%_sync';

-- Все таблицы должны иметь rowsecurity = true
```

### Проверка Realtime

В Supabase Dashboard → Database → Replication:
- Убедитесь что `supabase_realtime` publication включает все `*_sync` таблицы

## Шаг 7: Тестирование в приложении

1. Соберите фронтенд:
   ```bash
   yarn build
   ```

2. Разверните `dist/` на хостинг (например, Vercel, Netlify)

3. Откройте Mini App в Telegram и проверьте:
   - ✅ Авторизация через Telegram работает
   - ✅ Создание данных локально
   - ✅ Включение синхронизации в Settings
   - ✅ Данные появляются в Supabase Database
   - ✅ Изменения в Supabase отображаются в приложении (Realtime)

## Архитектура данных

### Модель Rooms & Sharing

Каждый пользователь получает личную комнату `"My Room"` при первой авторизации. Все данные связаны с `room_id`.

```
User (Telegram)
  → telegram-auth Edge Function
  → users table (создание/обновление)
  → Personal Room (создание если нет)
  → room_memberships (owner)
  → JWT token с room_id в metadata
```

### Синхронизация (RxDB ↔ Supabase)

```
Локальное изменение → RxDB (IndexedDB)
  ↓ (push via replication)
Supabase *_sync tables
  → RLS проверка (room_id в JWT)
  ↓ (Realtime event)
Другие устройства → (pull) → RxDB → UI обновление
```

### Безопасность (RLS)

Все sync таблицы защищены идентичной RLS политикой:

```sql
CREATE POLICY "User room access" ON {table}_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));
```

Пользователь может читать/записывать только данные из своей комнаты. `room_id` берется из JWT metadata, который подписан Supabase и не может быть подделан.

## Troubleshooting

### Ошибка: "new row violates row-level security policy"

**Причина:** JWT token не содержит `room_id` в `user_metadata`.

**Решение:**
1. Разлогиньтесь в приложении
2. Залогиньтесь заново (это обновит JWT)
3. Edge Function автоматически добавит `room_id` в metadata

### Ошибка: "Invalid Telegram authentication"

**Причина:** Неверный `BOT_TOKEN` или устаревший auth_date.

**Решение:**
1. Проверьте что `BOT_TOKEN` в Supabase Secrets совпадает с токеном от BotFather
2. Telegram auth данные действительны только 24 часа

### Синхронизация не работает

**Диагностика:**
1. Откройте приложение с `?debug=1` в URL (включится Eruda debugger)
2. Проверьте Console на ошибки
3. Проверьте что пользователь авторизован (`useAuth`)
4. Проверьте что синхронизация включена (`useSync`)
5. Проверьте Network tab для запросов к Supabase

## Дополнительные команды

```bash
# Откатить последнюю миграцию (ОСТОРОЖНО: потеря данных!)
supabase db reset --linked

# Просмотр логов Edge Function
supabase functions logs telegram-auth --project-ref YOUR_PROJECT_REF

# Генерация TypeScript типов из схемы БД
supabase gen types typescript --linked > src/lib/supabase/database.types.ts

# Backup базы данных
pg_dump -h db.YOUR_PROJECT_REF.supabase.co -U postgres -d postgres > backup.sql
```

## Поддержка

При возникновении проблем:
1. Проверьте [Supabase Documentation](https://supabase.com/docs)
2. Просмотрите логи в Supabase Dashboard → Logs
3. Используйте Eruda debugger в Mini App (`?debug=1`)

---

**Версия:** 1.0
**Совместимость:** Supabase CLI v1.x, @supabase/supabase-js v2.x
