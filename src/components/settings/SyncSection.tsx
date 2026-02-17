import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSync } from '../../contexts/SyncContext'
import { useToast } from '../../contexts/ToastContext'
import { TelegramLoginButton } from './TelegramLoginButton'
import { SyncToggle } from './SyncToggle'

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'только что'
  if (diffMins < 60) return `${diffMins} мин назад`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} ч назад`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} дн назад`
}

export function SyncSection() {
  const { user, isAuthenticated, logout } = useAuth()
  const { isSyncEnabled, isSyncing, lastSyncTime, syncError, toggleSync } = useSync()
  const { showToast } = useToast()

  useEffect(() => {
    if (syncError) showToast(syncError, 'error')
  }, [syncError])

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout failed:', error)
      showToast('Ошибка при выходе', 'error')
    }
  }

  const handleToggleSync = async (enabled: boolean) => {
    try {
      await toggleSync(enabled)
    } catch (error) {
      console.error('Toggle sync failed:', error)
      showToast('Ошибка переключения синхронизации', 'error')
    }
  }

  return (
    <section className="mb-6">
      <h2 className="text-[20px] font-semibold text-text mb-4">Синхронизация</h2>

      <div className="bg-surface rounded-xl p-4 border border-separator/30">
        {!isAuthenticated ? (
          <>
            <TelegramLoginButton />
            <SyncToggle enabled={false} disabled={true} onChange={() => {}} />
            <p className="text-[13px] text-text-hint mt-3">
              💡 Войдите через Telegram для синхронизации данных между устройствами
            </p>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-[20px]">
                  👤
                </div>
              )}
              <p className="text-[15px] text-text font-medium">
                {user?.username ? `@${user.username}` : user?.first_name}
              </p>
            </div>

            <SyncToggle
              enabled={isSyncEnabled}
              disabled={false}
              onChange={handleToggleSync}
            />

            {isSyncing && (
              <p className="text-[13px] text-text-hint mt-3">
                {lastSyncTime
                  ? `📊 Последняя синхронизация: ${formatRelativeTime(lastSyncTime)}`
                  : '📊 Синхронизация активна'
                }
              </p>
            )}

            {!isSyncing && isSyncEnabled && !syncError && (
              <p className="text-[13px] text-text-hint mt-3">
                📊 Синхронизация включена
              </p>
            )}

            <button
              onClick={handleLogout}
              className="mt-4 text-[15px] text-primary-text active:opacity-70 transition-opacity"
            >
              Выйти
            </button>
          </>
        )}
      </div>
    </section>
  )
}
