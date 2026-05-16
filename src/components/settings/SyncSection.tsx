import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSync } from '../../contexts/SyncContext'
import { useToast } from '../../contexts/ToastContext'
import { AuthMethods } from './AuthMethods'
import { SyncToggle } from './SyncToggle'
import { getDisplayName, getAvatarUrl } from '../../lib/supabase/userDisplay'

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
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          Синхронизация
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        {!isAuthenticated ? (
          <>
            <div className="px-4 py-3">
              <AuthMethods />
            </div>
            <div className="h-px bg-separator/20" />
            <div className="px-4 py-3">
              <SyncToggle enabled={false} disabled={true} onChange={() => {}} />
            </div>
            <div className="h-px bg-separator/20" />
            <div className="px-4 py-3">
              <p className="text-[13px] text-text-hint">
                Войдите через Telegram, Email или Google, чтобы синхронизировать данные между устройствами
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 flex items-center gap-3">
              {getAvatarUrl(user) ? (
                <img
                  src={getAvatarUrl(user)!}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-[20px] shrink-0">
                  👤
                </div>
              )}
              <p className="text-[15px] text-text font-medium">
                {getDisplayName(user)}
              </p>
            </div>

            <div className="h-px bg-separator/20 mx-4" />

            <div className="px-4 py-3">
              <SyncToggle
                enabled={isSyncEnabled}
                disabled={false}
                onChange={handleToggleSync}
              />
            </div>

            {(isSyncing || (!isSyncing && isSyncEnabled && !syncError)) && (
              <>
                <div className="h-px bg-separator/20 mx-4" />
                <div className="px-4 py-3">
                  <p className="text-[13px] text-text-hint">
                    {isSyncing && lastSyncTime
                      ? `Последняя синхронизация: ${formatRelativeTime(lastSyncTime)}`
                      : isSyncing
                        ? 'Синхронизация активна'
                        : 'Синхронизация включена'
                    }
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {isAuthenticated && (
        <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-3 text-[15px] text-destructive font-medium active:opacity-70 transition-opacity text-left"
          >
            Выйти
          </button>
        </div>
      )}
    </section>
  )
}
