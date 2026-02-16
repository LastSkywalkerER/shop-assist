# 🤖 Почему показывает "Bot domain invalid"?

## Проблема

Telegram Login Widget **не работает на localhost** по соображениям безопасности. Это ограничение Telegram API.

**Ошибка "Bot domain invalid"** означает, что:
- Виджет пытается загрузиться на `http://localhost:5173`
- Telegram проверяет домен и отклоняет его, потому что он не публичный

---

## Как это работает

```
┌─────────────────────────────────────────────┐
│ Telegram Login Widget Workflow              │
├─────────────────────────────────────────────┤
│                                             │
│  1. Пользователь нажимает "Login"          │
│  2. Telegram проверяет домен страницы      │
│  3. Сравнивает с разрешенным доменом бота  │
│                                             │
│  ❌ localhost → ОТКЛОНЕНО                   │
│  ✅ example.com → РАЗРЕШЕНО                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🚀 РЕШЕНИЕ 1: ngrok (Рекомендуется для разработки)

### Что такое ngrok?
ngrok создает безопасный туннель к вашему localhost с публичным HTTPS URL.

### Установка и настройка

**Шаг 1: Установить ngrok**
```bash
# macOS (Homebrew)
brew install ngrok

# или через npm
npm install -g ngrok

# или скачать с https://ngrok.com/download
```

**Шаг 2: Запустить туннель**
```bash
ngrok http 5173
```

Вы получите вывод:
```
Session Status                online
Account                       Free (limited)
Version                       3.x.x
Region                        United States (us)
Forwarding                    https://abc123.ngrok.io -> http://localhost:5173

Web Interface                 http://127.0.0.1:4040
```

**Важно:** Скопируйте URL вида `https://abc123.ngrok.io`

**Шаг 3: Настроить домен в BotFather**

1. Открыть Telegram и найти [@BotFather](https://t.me/BotFather)
2. Отправить команду `/setdomain`
3. Выбрать вашего бота `@SkyShopAssistBot`
4. Вставить ngrok URL: `https://abc123.ngrok.io`
5. BotFather подтвердит: ✅ "Success!"

**Шаг 4: Открыть приложение через ngrok**

⚠️ **ВАЖНО:** Открывайте приложение через ngrok URL, а НЕ через localhost!

```
❌ НЕ открывать: http://localhost:5173
✅ Открывать:    https://abc123.ngrok.io
```

**Шаг 5: Тестировать**

1. Открыть `https://abc123.ngrok.io/settings`
2. Telegram Login Widget должен загрузиться без ошибок
3. Нажать кнопку "Login"
4. Авторизоваться через Telegram
5. ✅ Успех!

### Важные заметки о ngrok

**Бесплатный план:**
- ✅ HTTPS туннель
- ✅ Случайный URL (меняется при перезапуске)
- ⚠️ URL истекает через 2 часа
- ⚠️ При перезапуске ngrok получите новый URL → нужно обновить в BotFather

**Платный план ($8/мес):**
- ✅ Постоянный URL (не меняется)
- ✅ Без лимита времени
- ✅ Кастомный домен

---

## 🌐 РЕШЕНИЕ 2: Deploy на продакшн

Если нужно для постоянного использования, разверните на реальном хостинге.

### Вариант A: Vercel (Рекомендуется)

```bash
# 1. Установить Vercel CLI
npm i -g vercel

# 2. Деплой
vercel

# Следовать инструкциям, получите URL: https://shop-assist.vercel.app
```

**В BotFather:**
```
/setdomain
@SkyShopAssistBot
https://shop-assist.vercel.app
```

### Вариант B: Netlify

```bash
# 1. Установить Netlify CLI
npm i -g netlify-cli

# 2. Деплой
netlify deploy --prod

# Получите URL: https://shop-assist.netlify.app
```

**В BotFather:**
```
/setdomain
@SkyShopAssistBot
https://shop-assist.netlify.app
```

### Вариант C: Свой домен

Если у вас есть домен (например, `shopassist.com`):

1. Deploy на любой хостинг (Vercel, Netlify, etc.)
2. Настроить DNS
3. В BotFather указать: `https://shopassist.com`

---

## ⚡ РЕШЕНИЕ 3: Тестировать без виджета (временно)

Можно обойти виджет и протестировать backend напрямую.

### Создать тестового пользователя вручную

**В Supabase SQL Editor:**

```sql
-- 1. Создать пользователя
INSERT INTO users (telegram_id, first_name, username, auth_date)
VALUES (123456789, 'Test User', 'testuser', extract(epoch from now())::bigint)
RETURNING id;

-- Скопируйте полученный UUID пользователя

-- 2. Создать комнату (замените USER_ID на UUID из шага 1)
INSERT INTO rooms (name, owner_id, is_personal)
VALUES ('My Room', 'USER_ID', true)
RETURNING id;

-- Скопируйте полученный UUID комнаты

-- 3. Добавить membership (замените USER_ID и ROOM_ID)
INSERT INTO room_memberships (user_id, room_id, role)
VALUES ('USER_ID', 'ROOM_ID', 'owner');
```

### Сохранить в localStorage

**В консоли браузера (localhost:5173):**

```javascript
// Замените на ваши реальные данные
const user = {
  id: 'USER_ID',
  telegram_id: 123456789,
  first_name: 'Test User',
  username: 'testuser'
}

const roomId = 'ROOM_ID'

localStorage.setItem('auth_user', JSON.stringify(user))
localStorage.setItem('auth_room_id', roomId)

// Перезагрузить страницу
location.reload()
```

Теперь вы будете "залогинены" и можете тестировать синхронизацию!

---

## 📋 Быстрый старт (рекомендуемый путь)

```bash
# Терминал 1: Dev сервер
yarn dev

# Терминал 2: ngrok
ngrok http 5173
```

**Затем:**
1. ✅ Скопировать ngrok URL (например: `https://abc123.ngrok.io`)
2. ✅ Настроить в BotFather: `/setdomain` → `@SkyShopAssistBot` → вставить URL
3. ✅ Открыть приложение через ngrok URL (не localhost!)
4. ✅ Перейти на `/settings`
5. ✅ Нажать "Войти через Telegram"
6. ✅ Авторизоваться
7. ✅ Включить синхронизацию
8. ✅ Тестировать!

---

## ❓ FAQ

**Q: Почему нельзя использовать localhost?**
A: Безопасность. Telegram хочет убедиться что виджет используется на реальном сайте, а не на локальной машине злоумышленника.

**Q: Нужно ли платить за ngrok?**
A: Нет, бесплатный план подходит для разработки. Минус - URL меняется при перезапуске.

**Q: Можно ли обойти ограничение localhost?**
A: Нет. Это жесткое ограничение Telegram API.

**Q: ngrok URL истёк, что делать?**
A: Перезапустить ngrok, получить новый URL, обновить в BotFather.

**Q: Как сделать постоянный URL?**
A: Платный план ngrok ($8/мес) или deploy на Vercel/Netlify бесплатно.

---

## ✅ Проверка что все работает

После настройки:

1. ✅ Открыть ngrok URL (не localhost!)
2. ✅ Перейти на `/settings`
3. ✅ Telegram Login Widget загружается (нет "Bot domain invalid")
4. ✅ Нажать кнопку "Login"
5. ✅ Открывается Telegram для авторизации
6. ✅ После авторизации создается user в Supabase
7. ✅ Создается "My Room"
8. ✅ Можно включить синхронизацию
9. ✅ Данные синхронизируются между устройствами

---

## 🎯 Итог

**"Bot domain invalid"** = localhost не разрешен

**Решения:**
- 🚀 ngrok (быстро, для разработки)
- 🌐 Vercel/Netlify (для продакшн)
- ⚡ Ручное создание user (для тестов)

Рекомендую начать с **ngrok** - это самый простой способ для разработки!
