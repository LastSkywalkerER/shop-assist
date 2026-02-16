# Инструкции по настройке Telegram авторизации

## Проблема: "Bot domain invalid"

Telegram Login Widget требует публичный домен (не работает с `localhost`).

## Решение 1: Использовать ngrok (Рекомендуется для разработки)

### Шаг 1: Установить ngrok
```bash
npm install -g ngrok
```

### Шаг 2: Запустить ngrok туннель
```bash
ngrok http 5173
```

Вы получите URL вида: `https://abc123.ngrok.io`

### Шаг 3: Настроить домен в BotFather

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram
2. Выполнить команду:
   ```
   /setdomain
   ```
3. Выбрать бота `@SkyShopAssistBot`
4. Указать ngrok URL (например: `https://abc123.ngrok.io`)

### Шаг 4: Обновить приложение

Перезапустить dev сервер:
```bash
yarn dev
```

Открыть приложение через ngrok URL: `https://abc123.ngrok.io`

---

## Решение 2: Настроить BOT_TOKEN и протестировать напрямую

Можно протестировать Edge Function напрямую без виджета:

### Шаг 1: Настроить BOT_TOKEN в Supabase

Через Dashboard:
1. Открыть https://supabase.com/dashboard/project/lmdjawmxlxpecxrnkyis
2. Settings → Edge Functions → Secrets
3. Add new secret:
   - Name: `BOT_TOKEN`
   - Value: `7675264167:AAH8nOjBiZOX3J__QIoNpLhcIoHKfwKFFPc`

### Шаг 2: Протестировать через curl

```bash
curl -X POST https://lmdjawmxlxpecxrnkyis.supabase.co/functions/v1/telegram-auth \
  -H "Content-Type: application/json" \
  -d '{
    "id": 123456789,
    "first_name": "Test",
    "username": "testuser",
    "auth_date": 1234567890,
    "hash": "test_hash"
  }'
```

---

## Решение 3: Deploy на продакшн

Развернуть на Vercel/Netlify и использовать реальный домен:

```bash
# Vercel
vercel deploy

# Netlify
netlify deploy --prod
```

Затем настроить домен в BotFather.

---

## Проверка работы

После настройки домена:

1. ✅ Открыть `/settings`
2. ✅ Telegram Login Widget должен загрузиться
3. ✅ Нажать "Login"
4. ✅ Авторизоваться через Telegram
5. ✅ Проверить что создался user в Supabase (`users` таблица)
6. ✅ Проверить что создалась комната (`rooms` таблица)
7. ✅ Включить синхронизацию
8. ✅ Создать продукт/расход
9. ✅ Проверить что данные появились в `*_sync` таблицах

---

## Текущий статус реализации

✅ База данных настроена (3 миграции)
✅ Edge Function развернута
✅ Frontend авторизация готова
✅ RxDB Replication настроена
✅ UI для синхронизации готов

⚠️ Требуется:
- Настроить BOT_TOKEN secret
- Настроить домен для Telegram Login Widget
