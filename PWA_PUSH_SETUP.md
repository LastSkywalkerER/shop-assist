# PWA Push Notifications — setup

The app delivers shopping-list notifications through two channels:

1. **PWA Web Push** (priority) — sent to browsers/devices that have installed the PWA, granted notification permission, and registered a push subscription.
2. **Telegram bot** (fallback) — sent to users who linked their Telegram account.

Each user has independent toggles in Settings → Уведомления. The server picks PWA when both are enabled and at least one push subscription exists; otherwise it falls back to Telegram.

PWA push is **hidden inside the Telegram Mini App** (Web Push does not work in TG's WebView).

## VAPID keys

Generate a key pair once (any machine with Node):

```bash
npx web-push generate-vapid-keys
```

You'll get a `publicKey` and `privateKey`. Store them as follows:

### Client (`.env` for Vite)

```dotenv
VITE_VAPID_PUBLIC_KEY=<publicKey>
```

### Edge function secrets (Supabase)

```bash
supabase secrets set VAPID_PUBLIC_KEY=<publicKey>
supabase secrets set VAPID_PRIVATE_KEY=<privateKey>
supabase secrets set VAPID_SUBJECT=mailto:you@example.com
```

`VAPID_SUBJECT` must be a `mailto:` URL or an `https://` URL identifying the application owner.

## Database migration

```bash
supabase db push  # applies 20260516120000_push_subscriptions_and_prefs.sql
```

This adds:
- `users.notify_via_pwa boolean default true`
- `users.notify_via_telegram boolean default true`
- `push_subscriptions` table with RLS so each user only sees/manages their own rows.

## Deploying the edge function

```bash
supabase functions deploy send-notification
```

The function reads the VAPID secrets at startup and signs Web Push requests via `web-push@3.6.7` (loaded from esm.sh).

## Service worker

The PWA now uses `injectManifest` mode. The custom worker lives in `src/pwa/sw.ts` and registers a `push` handler that calls `showNotification()` plus a `notificationclick` handler that focuses an existing tab or opens the target URL.

## Verifying end-to-end

1. Install the PWA in a desktop Chrome (or any browser supporting Web Push).
2. Open Settings → Уведомления → press **Включить** on the "Push в PWA" row. A row should appear in `push_subscriptions`.
3. From another device or via SQL, insert a shopping list item — the desktop should show a system notification within ~10 s.
4. Toggle "Push в PWA" off → next item triggers a Telegram message instead.
5. Open the app inside Telegram → PWA row is hidden, Telegram row is shown; delivery still works.

If a browser later revokes the subscription, the server gets `404`/`410` and deletes the row automatically.
