import { useState, type FormEvent } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { confirmNewAccountOrAbort } from '../../lib/supabase/accountHint'

type Mode = 'signin' | 'signup'

export function EmailAuthForm() {
  const { signUpWithEmail, signInWithEmail } = useAuth()
  const { showToast } = useToast()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const ok = await confirmNewAccountOrAbort('email')
    if (!ok) return
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await signUpWithEmail(email, password)
        showToast(
          result.needsConfirmation
            ? 'Письмо для подтверждения отправлено. Откройте ссылку, чтобы завершить регистрацию.'
            : 'Регистрация успешна!',
          'success',
        )
      } else {
        await signInWithEmail(email, password)
        showToast('Вы вошли', 'success')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-1 p-1 bg-separator/15 rounded-xl">
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors ${
            mode === 'signin' ? 'bg-bg text-text shadow-sm' : 'text-text-hint'
          }`}
        >
          Войти
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors ${
            mode === 'signup' ? 'bg-bg text-text shadow-sm' : 'text-text-hint'
          }`}
        >
          Регистрация
        </button>
      </div>

      <input
        type="email"
        autoComplete="email"
        required
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2 text-[15px] bg-separator/15 rounded-xl border border-separator/15 focus:outline-none focus:border-primary/40"
      />
      <input
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={6}
        placeholder="Пароль"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full px-3 py-2 text-[15px] bg-separator/15 rounded-xl border border-separator/15 focus:outline-none focus:border-primary/40"
      />
      <button
        type="submit"
        disabled={busy}
        className="w-full py-2.5 text-[15px] font-medium bg-primary text-white rounded-xl active:opacity-70 disabled:opacity-50 transition-opacity"
      >
        {busy ? '...' : mode === 'signup' ? 'Создать аккаунт' : 'Войти'}
      </button>
    </form>
  )
}
