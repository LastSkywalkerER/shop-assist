import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { fetchAuthIdentities } from '../../lib/supabase/auth'
import { GoogleAuthButton } from './GoogleAuthButton'
import { TelegramLinkButton } from './TelegramLinkButton'

type ProviderState = {
  email: { linked: boolean; value?: string; synthetic: boolean }
  google: { linked: boolean }
  telegram: { linked: boolean }
}

const SYNTHETIC_EMAIL_SUFFIX = '@telegram.user'

export function LinkedProvidersSection() {
  const { user, isAuthenticated, setEmailPassword } = useAuth()
  const { showToast } = useToast()
  const [providers, setProviders] = useState<ProviderState | null>(null)
  const [showEmailForm, setShowEmailForm] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setProviders(null)
      return
    }
    let cancelled = false
    fetchAuthIdentities().then((identities) => {
      if (cancelled) return
      const hasEmail = identities.some((i) => i.provider === 'email')
      const hasGoogle = identities.some((i) => i.provider === 'google')
      const emailValue = user?.email
      const synthetic = !!emailValue && emailValue.endsWith(SYNTHETIC_EMAIL_SUFFIX)
      setProviders({
        email: { linked: hasEmail && !synthetic && !!emailValue, value: synthetic ? undefined : emailValue, synthetic },
        google: { linked: hasGoogle || !!user?.google_id },
        telegram: { linked: !!user?.telegram_id },
      })
    }).catch(() => {
      if (!cancelled) setProviders(null)
    })
    return () => { cancelled = true }
  }, [isAuthenticated, user?.id, user?.email, user?.google_id, user?.telegram_id])

  if (!isAuthenticated || !providers) return null

  return (
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          Способы входа
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <ProviderRow
          icon="📧"
          title="Email"
          subtitle={providers.email.linked ? providers.email.value : 'Добавить email и пароль'}
          linked={providers.email.linked}
          action={
            providers.email.linked ? null : (
              <button
                type="button"
                onClick={() => setShowEmailForm((v) => !v)}
                className="text-[13px] text-primary font-medium"
              >
                {showEmailForm ? 'Отмена' : 'Привязать'}
              </button>
            )
          }
        />
        {showEmailForm && !providers.email.linked && (
          <div className="px-4 py-3 border-t border-separator/20">
            <SetEmailForm
              onSubmit={async (email, password) => {
                try {
                  await setEmailPassword(email, password)
                  showToast('Письмо для подтверждения email отправлено', 'success')
                  setShowEmailForm(false)
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Не удалось привязать email', 'error')
                }
              }}
            />
          </div>
        )}

        <div className="h-px bg-separator/20" />

        <ProviderRow
          icon="🟢"
          title="Google"
          subtitle={providers.google.linked ? 'Привязан' : 'Войти и через Google'}
          linked={providers.google.linked}
          action={providers.google.linked ? null : <GoogleAuthButton mode="link" label="Привязать" />}
        />

        <div className="h-px bg-separator/20" />

        <ProviderRow
          icon="✈️"
          title="Telegram"
          subtitle={providers.telegram.linked ? 'Привязан' : 'Привязать через Telegram-виджет'}
          linked={providers.telegram.linked}
          action={providers.telegram.linked ? null : <TelegramLinkButton />}
        />
      </div>
    </section>
  )
}

function ProviderRow({
  icon,
  title,
  subtitle,
  linked,
  action,
}: {
  icon: string
  title: string
  subtitle?: string
  linked: boolean
  action: React.ReactNode
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className="text-[20px] w-6 text-center" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-text font-medium">{title}</p>
        {subtitle && <p className="text-[13px] text-text-hint truncate">{subtitle}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {linked && <span className="text-success text-[15px]" aria-label="linked">✓</span>}
        {action}
      </div>
    </div>
  )
}

function SetEmailForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handle = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try { await onSubmit(email, password) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={handle} className="space-y-2">
      <input
        type="email" required autoComplete="email" placeholder="Email"
        value={email} onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2 text-[15px] bg-separator/15 rounded-xl border border-separator/15 focus:outline-none focus:border-primary/40"
      />
      <input
        type="password" required minLength={6} autoComplete="new-password" placeholder="Пароль (мин. 6)"
        value={password} onChange={(e) => setPassword(e.target.value)}
        className="w-full px-3 py-2 text-[15px] bg-separator/15 rounded-xl border border-separator/15 focus:outline-none focus:border-primary/40"
      />
      <button
        type="submit" disabled={busy}
        className="w-full py-2 text-[15px] font-medium bg-primary text-white rounded-xl active:opacity-70 disabled:opacity-50 transition-opacity"
      >
        {busy ? '...' : 'Сохранить'}
      </button>
    </form>
  )
}
