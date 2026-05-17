import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmDialogContext'
import { useToast } from '../../contexts/ToastContext'
import { isMiniApp } from '../../telegram/detect'
import {
  getPushStatus,
  isPushSupported,
  setNotificationPreference,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSubscriptionStatus,
} from '../../notifications/pushClient'

export function NotificationChannelsSection() {
  const { user, isAuthenticated } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const inMiniApp = isMiniApp()
  const showPwa = !inMiniApp && isPushSupported()

  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus | null>(null)
  const [pwaEnabled, setPwaEnabled] = useState<boolean>(user?.notify_via_pwa !== false)
  const [tgEnabled, setTgEnabled] = useState<boolean>(user?.notify_via_telegram !== false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPwaEnabled(user?.notify_via_pwa !== false)
    setTgEnabled(user?.notify_via_telegram !== false)
  }, [user?.notify_via_pwa, user?.notify_via_telegram])

  const refreshPushStatus = useCallback(async () => {
    if (!showPwa) {
      setPushStatus(null)
      return
    }
    try {
      setPushStatus(await getPushStatus())
    } catch (err) {
      console.error('Failed to read push status:', err)
    }
  }, [showPwa])

  useEffect(() => {
    refreshPushStatus()
  }, [refreshPushStatus])

  if (!isAuthenticated || !user) return null

  const handleSubscribe = async () => {
    if (busy) return
    setBusy(true)
    try {
      await subscribeToPush(user.id)
      if (!pwaEnabled) {
        await setNotificationPreference(user.id, 'notify_via_pwa', true)
        setPwaEnabled(true)
      }
      await refreshPushStatus()
      showToast('PWA-уведомления включены', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Не удалось включить уведомления: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleUnsubscribe = async () => {
    if (busy) return
    const ok = await confirm({
      title: 'Отключить PWA-пуши?',
      message: 'Подписка этого устройства будет удалена. Уведомления перестанут приходить здесь.',
      confirmLabel: 'Отключить',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await unsubscribeFromPush()
      await refreshPushStatus()
      showToast('Подписка отключена', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Не удалось отписаться: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePwa = async (value: boolean) => {
    if (busy) return
    setBusy(true)
    setPwaEnabled(value)
    try {
      await setNotificationPreference(user.id, 'notify_via_pwa', value)
    } catch (err) {
      setPwaEnabled(!value)
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Не удалось сохранить: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleTg = async (value: boolean) => {
    if (busy) return
    setBusy(true)
    setTgEnabled(value)
    try {
      await setNotificationPreference(user.id, 'notify_via_telegram', value)
    } catch (err) {
      setTgEnabled(!value)
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Не удалось сохранить: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const hasTelegram = !!user.telegram_id

  return (
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          Уведомления
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        {showPwa && (
          <>
            <PwaRow
              status={pushStatus}
              enabled={pwaEnabled}
              busy={busy}
              onSubscribe={handleSubscribe}
              onUnsubscribe={handleUnsubscribe}
              onToggle={handleTogglePwa}
            />
            <div className="h-px bg-separator/20" />
          </>
        )}

        <TelegramRow
          linked={hasTelegram}
          enabled={tgEnabled}
          busy={busy}
          onToggle={handleToggleTg}
        />
      </div>

      <p className="px-4 pt-2 text-[12px] text-text-hint">
        {showPwa
          ? 'Приоритет — PWA-пуши. Если они включены и устройство подписано, в Telegram уведомление не дублируется.'
          : 'PWA-пуши недоступны в этом окружении.'}
      </p>
    </section>
  )
}

function PwaRow({
  status,
  enabled,
  busy,
  onSubscribe,
  onUnsubscribe,
  onToggle,
}: {
  status: PushSubscriptionStatus | null
  enabled: boolean
  busy: boolean
  onSubscribe: () => void
  onUnsubscribe: () => void
  onToggle: (v: boolean) => void
}) {
  const subtitle = (() => {
    if (!status) return 'Проверка…'
    if (!status.vapidConfigured) return 'VAPID-ключ не настроен'
    if (status.permission === 'denied') return 'Разрешите уведомления в настройках браузера'
    if (!status.hasSubscription) return 'Подписка не активна'
    return enabled ? 'Подписка активна' : 'Подписка активна, доставка выключена'
  })()

  const action = (() => {
    if (!status || !status.vapidConfigured) return null
    if (status.permission === 'denied') return null
    if (!status.hasSubscription) {
      return (
        <button
          type="button"
          onClick={onSubscribe}
          disabled={busy}
          className="text-[13px] text-primary font-medium disabled:opacity-50"
        >
          Включить
        </button>
      )
    }
    return (
      <div className="flex items-center gap-3">
        <Toggle enabled={enabled} disabled={busy} onChange={onToggle} />
        <button
          type="button"
          onClick={onUnsubscribe}
          disabled={busy}
          className="text-[13px] text-danger font-medium disabled:opacity-50"
        >
          Отписаться
        </button>
      </div>
    )
  })()

  return (
    <Row icon="🔔" title="Push в PWA" subtitle={subtitle} action={action} />
  )
}

function TelegramRow({
  linked,
  enabled,
  busy,
  onToggle,
}: {
  linked: boolean
  enabled: boolean
  busy: boolean
  onToggle: (v: boolean) => void
}) {
  const subtitle = linked
    ? enabled ? 'Включено' : 'Выключено'
    : 'Сначала привяжите Telegram в разделе «Способы входа»'

  return (
    <Row
      icon="✈️"
      title="Telegram"
      subtitle={subtitle}
      action={linked ? <Toggle enabled={enabled} disabled={busy} onChange={onToggle} /> : null}
    />
  )
}

function Row({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: string
  title: string
  subtitle: string
  action: React.ReactNode
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className="text-[20px] w-6 text-center" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-text font-medium">{title}</p>
        <p className="text-[13px] text-text-hint truncate">{subtitle}</p>
      </div>
      <div className="shrink-0 flex items-center">{action}</div>
    </div>
  )
}

function Toggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="relative inline-block">
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className={`
        w-11 h-6 rounded-full transition-colors
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        bg-separator/40
        peer-checked:bg-primary
        peer-disabled:opacity-50
      `} />
      <div className={`
        absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
        ${enabled ? 'translate-x-5' : 'translate-x-0'}
      `} />
    </label>
  )
}
