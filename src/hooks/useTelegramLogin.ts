import { useEffect } from 'react'
import type { TelegramAuthData } from '../lib/supabase/types'

interface UseTelegramLoginOptions {
  botName: string
  onAuth: (authData: TelegramAuthData) => void
}

export function useTelegramLogin({ botName, onAuth }: UseTelegramLoginOptions) {
  useEffect(() => {
    // Создать глобальную функцию для callback
    (window as any).onTelegramAuth = (user: TelegramAuthData) => {
      onAuth(user)
    }

    // Инжектировать скрипт Telegram Widget
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botName)
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
  }, [botName, onAuth])
}
