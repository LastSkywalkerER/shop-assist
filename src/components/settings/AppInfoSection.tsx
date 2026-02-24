import { useState, useRef, useEffect } from 'react'
import { useUpdatePrompt } from '../../pwa/useUpdatePrompt'
import { getDatabaseVersion } from '../../db/version'
import packageJson from '../../../package.json'

export function AppInfoSection() {
  const { checkForUpdate, needRefresh } = useUpdatePrompt()
  const [isChecking, setIsChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState<string | null>(null)
  const needRefreshRef = useRef(needRefresh)

  useEffect(() => {
    needRefreshRef.current = needRefresh
  }, [needRefresh])

  const appVersion = packageJson.version
  const dbVersion = getDatabaseVersion()

  const handleCheckUpdate = async () => {
    setIsChecking(true)
    setCheckMessage(null)

    try {
      await checkForUpdate()

      setTimeout(() => {
        setIsChecking(false)
        if (!needRefreshRef.current) {
          setCheckMessage('✅ У вас установлена последняя версия')
          setTimeout(() => setCheckMessage(null), 3000)
        }
      }, 2000)
    } catch (error) {
      setIsChecking(false)
      setCheckMessage('❌ Ошибка проверки обновлений')
      setTimeout(() => setCheckMessage(null), 3000)
    }
  }

  return (
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          О приложении
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] text-text-hint">Версия приложения</span>
          <span className="text-[15px] text-text font-medium">{appVersion}</span>
        </div>
        <div className="h-px bg-separator/20 mx-4" />
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] text-text-hint">Версия БД</span>
          <span className="text-[15px] text-text font-medium">{dbVersion}</span>
        </div>
      </div>

      {needRefresh && (
        <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-primary/20">
          <div className="px-4 py-3">
            <p className="text-[13px] text-primary-text">✨ Доступна новая версия</p>
          </div>
        </div>
      )}

      {checkMessage && (
        <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
          <div className="px-4 py-3">
            <p className="text-[13px] text-text">{checkMessage}</p>
          </div>
        </div>
      )}

      <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
        <button
          onClick={handleCheckUpdate}
          disabled={isChecking}
          className="w-full px-4 py-3 text-[15px] text-primary-text font-medium active:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isChecking ? (
            <>
              <div className="w-4 h-4 border-2 border-primary-text border-t-transparent rounded-full animate-spin" />
              Проверка...
            </>
          ) : (
            'Проверить обновления'
          )}
        </button>
      </div>
    </section>
  )
}
