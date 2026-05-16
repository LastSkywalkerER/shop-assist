import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import type { TelegramAuthData } from '../../lib/supabase/types'

export function TelegramLinkButton() {
  const { linkTelegram } = useAuth()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(window as any).onTelegramLink = async (user: TelegramAuthData) => {
      if (busy) return
      setBusy(true)
      try {
        await linkTelegram(user)
        showToast('Telegram привязан', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Не удалось привязать Telegram'
        showToast(message, 'error')
      } finally {
        setBusy(false)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', 'SkyShopAssistBot')
    script.setAttribute('data-size', 'medium')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-request-access', 'write')
    script.setAttribute('data-onauth', 'onTelegramLink(user)')
    script.async = true

    const container = document.getElementById('telegram-link-container')
    if (container) container.appendChild(script)

    return () => {
      if (container && script.parentNode === container) container.removeChild(script)
      delete (window as any).onTelegramLink
    }
  }, [linkTelegram, showToast, busy])

  return <div id="telegram-link-container" />
}
