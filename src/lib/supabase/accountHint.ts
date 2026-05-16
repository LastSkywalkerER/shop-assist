import type { User } from './types'
import { supabase } from './client'

const HINT_KEY = 'auth_last_account_hint'
const SYNTHETIC_EMAIL_SUFFIX = '@telegram.user'

export type Provider = 'telegram' | 'email' | 'google'

export interface AccountHint {
  authUserId: string
  providers: Provider[]
  displayName: string
  updatedAt: number
}

function providerLabel(p: Provider): string {
  if (p === 'telegram') return 'Telegram'
  if (p === 'email') return 'Email'
  return 'Google'
}

export async function writeAccountHint(user: User): Promise<void> {
  const providers = new Set<Provider>()
  if (user.telegram_id) providers.add('telegram')
  if (user.google_id) providers.add('google')
  if (user.email && !user.email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) providers.add('email')

  // Cross-check with auth identities so we catch a Google/email link even before
  // the public.users column is populated by the trigger.
  try {
    const { data } = await supabase.auth.getUser()
    for (const id of data.user?.identities ?? []) {
      if (id.provider === 'google') providers.add('google')
      if (id.provider === 'email') providers.add('email')
    }
  } catch { /* ignore */ }

  const displayName =
    user.display_name ||
    (user.username ? `@${user.username}` : '') ||
    [user.first_name, user.last_name].filter(Boolean).join(' ') ||
    (user.email && !user.email.endsWith(SYNTHETIC_EMAIL_SUFFIX) ? user.email : '') ||
    'аккаунт'

  const hint: AccountHint = {
    authUserId: user.auth_user_id ?? '',
    providers: [...providers],
    displayName,
    updatedAt: Date.now(),
  }
  try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)) } catch { /* ignore */ }
}

export function getAccountHint(): AccountHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AccountHint
    if (!Array.isArray(parsed.providers)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearAccountHint(): void {
  try { localStorage.removeItem(HINT_KEY) } catch { /* ignore */ }
}

/**
 * Returns a confirmation message if signing in via `target` would likely create
 * a new account separate from the one this device used most recently.
 * Returns null when no hint exists or the target provider is already known.
 */
export function getNewAccountWarning(target: Provider): string | null {
  const hint = getAccountHint()
  if (!hint || hint.providers.length === 0) return null
  if (hint.providers.includes(target)) return null

  const knownList = hint.providers.map(providerLabel).join(' и ')
  return (
    `На этом устройстве вы недавно входили как «${hint.displayName}» через ${knownList}.\n\n` +
    `Если продолжите вход через ${providerLabel(target)}, создастся НОВЫЙ аккаунт — данные старого никуда не денутся, но их не будет видно в новом.\n\n` +
    `Чтобы добавить ${providerLabel(target)} к существующему аккаунту: войдите прежним способом (${knownList}) и нажмите «Привязать ${providerLabel(target)}» в Настройках.\n\n` +
    `Всё равно создать новый аккаунт?`
  )
}

/** Run a confirm before invoking an action that could fork the account. */
export async function confirmNewAccountOrAbort(target: Provider): Promise<boolean> {
  const warning = getNewAccountWarning(target)
  if (!warning) return true
  const ok = typeof window !== 'undefined' && window.confirm(warning)
  if (ok) clearAccountHint()
  return ok
}
