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

  // Версии из package.json и RxDB schemas
  const appVersion = packageJson.version
  const dbVersion = getDatabaseVersion()

  const handleCheckUpdate = async () => {
    setIsChecking(true)
    setCheckMessage(null)

    try {
      await checkForUpdate()

      // Даем время SW обработать обновление
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
      <h2 className="text-[20px] font-semibold text-text mb-4">О приложении</h2>

      <div className="bg-surface rounded-xl p-4 border border-separator/30">
        <div className="space-y-2 mb-4">
          <div className="flex justify-between">
            <span className="text-[15px] text-text-hint">Версия приложения</span>
            <span className="text-[15px] text-text font-medium">{appVersion}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[15px] text-text-hint">Версия БД</span>
            <span className="text-[15px] text-text font-medium">{dbVersion}</span>
          </div>
        </div>

        {needRefresh && (
          <div className="mb-3 px-3 py-2 bg-primary/10 rounded-lg">
            <p className="text-[13px] text-primary-text">
              ✨ Доступна новая версия
            </p>
          </div>
        )}

        {checkMessage && (
          <div className="mb-3 px-3 py-2 bg-bg-secondary rounded-lg">
            <p className="text-[13px] text-text">{checkMessage}</p>
          </div>
        )}

        <button
          onClick={handleCheckUpdate}
          disabled={isChecking}
          className="w-full px-4 py-2.5 bg-primary text-white rounded-lg font-medium text-[15px] active:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isChecking ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
