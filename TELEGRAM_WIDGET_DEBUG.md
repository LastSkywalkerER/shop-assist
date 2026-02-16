# Telegram Login Widget - Отладка "Bot domain invalid"

## Проблема
Виджет показывает "Bot domain invalid" на домене https://shop-assist.sky-tehnol.uk/

## Решение

### 1️⃣ Настроить /setdomain в BotFather

Это **критически важно**! Main App и Menu Button — это разные настройки.

**Откройте [@BotFather](https://t.me/BotFather):**

```
/setdomain
→ Выберите @SkyShopAssistBot
→ Введите: shop-assist.sky-tehnol.uk
```

**ВАЖНО:**
- ❌ НЕ используйте `https://`
- ❌ НЕ добавляйте `/` в конце
- ✅ Только домен: `shop-assist.sky-tehnol.uk`

### 2️⃣ Проверить консоль браузера

Откройте https://shop-assist.sky-tehnol.uk/settings

**В консоли должны быть логи:**
```
🔵 TelegramLoginButton: Initializing widget
🔵 Current domain: shop-assist.sky-tehnol.uk
🔵 Appending widget to container
✅ Telegram widget script loaded
```

**Если есть ошибки:**
- `❌ Failed to load Telegram widget script` → проблема с загрузкой скрипта
- `❌ Container not found` → проблема с React рендером
- `Bot domain invalid` в iframe → `/setdomain` не настроен

### 3️⃣ Проверить iframe виджета

После настройки `/setdomain` виджет должен отрендериться как `<iframe>`.

**В DevTools Elements найдите:**
```html
<div id="telegram-login-container">
  <script src="https://telegram.org/js/telegram-widget.js?22"></script>
  <iframe src="https://oauth.telegram.org/..."></iframe>
</div>
```

**Если iframe есть, но показывает ошибку:**
- Откройте iframe URL в новой вкладке
- Проверьте текст ошибки
- Возможно нужно подождать несколько минут после `/setdomain`

### 4️⃣ Альтернатива: тестирование на localhost

Если не получается настроить домен, можно **временно** использовать ngrok:

```bash
# Установить ngrok
brew install ngrok  # или скачать с https://ngrok.com

# Запустить приложение
yarn dev

# В другом терминале
ngrok http 5173

# Скопировать URL (например: https://abc123.ngrok.io)
# Настроить в BotFather: /setdomain → abc123.ngrok.io
```

### 5️⃣ Проверить настройки бота

В [@BotFather](https://t.me/BotFather):

```
/mybots
→ @SkyShopAssistBot
→ Bot Settings
→ Domain

Должно быть: shop-assist.sky-tehnol.uk
```

Если пусто или другой домен → выполните `/setdomain` снова.

---

## Частые ошибки

### "Bot domain invalid"
**Причина:** Не настроен `/setdomain` или указан неправильный формат.
**Решение:** `/setdomain` → `shop-assist.sky-tehnol.uk` (без https://)

### Виджет не загружается
**Причина:** CSP блокирует `telegram.org` или `oauth.telegram.org`.
**Решение:** Проверить консоль браузера, добавить домены в CSP если есть.

### "Container not found"
**Причина:** React не успел отрендерить элемент.
**Решение:** Уже исправлено в коде (useEffect).

### Виджет загружается, но ничего не происходит
**Причина:** callback `onTelegramAuth` не вызывается.
**Решение:** Проверить логи в консоли (`✅ Telegram auth received`).

---

## Тестирование после настройки

1. Откройте https://shop-assist.sky-tehnol.uk/settings
2. Откройте консоль браузера (F12)
3. Проверьте логи (должны быть сообщения с 🔵 и ✅)
4. Кликните на кнопку "Log in via Telegram"
5. Авторизуйтесь в Telegram
6. Проверьте консоль: должно быть `✅ Telegram auth received`
7. Проверьте UI: должен появиться username и toggle синхронизации

---

## После успешной авторизации

1. Настройте `BOT_TOKEN` в Supabase Dashboard:
   - Откройте https://supabase.com/dashboard/project/lmdjawmxlxpecxrnkyis/settings/functions
   - Edge Functions → Environment Variables
   - Добавьте `BOT_TOKEN` = `7675264167:AAH8nOjBiZOX3J__QIoNpLhcIoHKfwKFFPc`

2. Включите синхронизацию через toggle

3. Создайте тестовые данные и проверьте синхронизацию

---

## Контакты для помощи

Если проблема не решается:
- Telegram: @username
- Issue: https://github.com/user/shop-assist/issues
