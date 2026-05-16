import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

interface Props {
  mode: 'signin' | 'link'
  label?: string
}

export function GoogleAuthButton({ mode, label }: Props) {
  const { signInWithGoogle, linkGoogle } = useAuth()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'link') {
        await linkGoogle()
      } else {
        await signInWithGoogle()
      }
      // Redirect happens; no further UI action needed.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed'
      showToast(message, 'error')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="w-full py-2.5 px-3 flex items-center justify-center gap-2 text-[15px] font-medium bg-bg border border-separator/30 rounded-xl active:opacity-70 disabled:opacity-50 transition-opacity"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.13 4.13 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.61z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.83.86-3.05.86a5.27 5.27 0 0 1-4.96-3.66H.96v2.34A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M4.04 10.76A5.4 5.4 0 0 1 3.76 9c0-.61.1-1.2.28-1.76V4.9H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.1l3.08-2.34z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 9 9 0 0 0 .96 4.9l3.08 2.34A5.27 5.27 0 0 1 9 3.58z" />
      </svg>
      <span>{busy ? '...' : label ?? (mode === 'link' ? 'Привязать Google' : 'Войти через Google')}</span>
    </button>
  )
}
