import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { getNewAccountWarning, clearAccountHint } from '../../lib/supabase/accountHint'
import type { TelegramAuthData } from '../../lib/supabase/types'

export function TelegramLoginButton() {
  const { login } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    // Создать глобальную функцию для callback
    (window as any).onTelegramAuth = async (user: TelegramAuthData) => {
      const warning = getNewAccountWarning('telegram')
      if (warning) {
        const ok = await confirm({ ...warning, destructive: true })
        if (!ok) return
        clearAccountHint()
      }
      try {
        await login(user)
        showToast('Успешная авторизация!', 'success')
      } catch (error) {
        console.error('Login failed:', error)
        showToast('Ошибка авторизации. Попробуйте еще раз.', 'error')
      }
    }

    // Инжектировать скрипт Telegram Widget
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', 'SkyShopAssistBot')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-request-access', 'write')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.async = true

    const container = document.getElementById('telegram-login-container')
    if (container) {
      container.appendChild(script)
    }

    return () => {
      // Очистка
      if (container && script.parentNode === container) {
        container.removeChild(script)
      }
      delete (window as any).onTelegramAuth
    }
  }, [login, confirm, showToast])

  return <div id="telegram-login-container" className="mb-4" />
}
