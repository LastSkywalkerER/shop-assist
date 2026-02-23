import { useState } from 'react'
import {
  deleteRxDatabase,
  pickAndParseBackupFile,
  getLastBackupMeta,
  formatBytes,
  type BackupFile,
} from '../db/backup'

interface RecoveryScreenProps {
  error: Error
  onRetry: () => void
}

type RecoveryStep =
  | { step: 'idle' }
  | { step: 'confirm-rollback' }
  | { step: 'working'; message: string }
  | { step: 'rollback-complete' }
  | { step: 'recovery-error'; message: string }

export function RecoveryScreen({ error, onRetry }: RecoveryScreenProps) {
  const [state, setState] = useState<RecoveryStep>({ step: 'idle' })
  const lastBackupMeta = getLastBackupMeta()

  const handleStartFresh = async () => {
    setState({ step: 'working', message: 'Удаление локальной базы данных...' })
    try {
      await deleteRxDatabase()
      setState({ step: 'rollback-complete' })
    } catch (err) {
      setState({
        step: 'recovery-error',
        message: err instanceof Error ? err.message : 'Не удалось удалить базу данных',
      })
    }
  }

  const handleRestoreFromBackup = async () => {
    setState({ step: 'working', message: 'Выберите файл резервной копии...' })
    let backup: BackupFile
    try {
      backup = await pickAndParseBackupFile()
    } catch (err) {
      if (err instanceof Error && err.message === 'File selection cancelled') {
        setState({ step: 'confirm-rollback' })
        return
      }
      setState({
        step: 'recovery-error',
        message: err instanceof Error ? err.message : 'Недопустимый файл резервной копии',
      })
      return
    }

    setState({ step: 'working', message: 'Удаление локальной базы данных...' })
    try {
      await deleteRxDatabase()
    } catch (err) {
      setState({
        step: 'recovery-error',
        message: err instanceof Error ? err.message : 'Не удалось удалить базу данных',
      })
      return
    }

    sessionStorage.setItem('pending_restore', JSON.stringify(backup))
    setState({ step: 'working', message: 'Перезапуск приложения...' })
    window.location.reload()
  }

  if (state.step === 'working') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-4 p-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-text-hint text-[13px]">{state.message}</p>
      </div>
    )
  }

  if (state.step === 'rollback-complete') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-4 p-6">
        <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center text-2xl">
          ✓
        </div>
        <div className="text-center">
          <h1 className="text-[17px] font-semibold text-text mb-1">База данных очищена</h1>
          <p className="text-[13px] text-text-hint">Приложение запустится заново с чистой базой.</p>
        </div>
        <button
          onClick={onRetry}
          className="w-full max-w-sm py-3 bg-primary text-white rounded-xl font-medium text-[15px] active:bg-primary/90 transition-colors"
        >
          Запустить приложение
        </button>
      </div>
    )
  }

  if (state.step === 'recovery-error') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-4 p-6">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center text-2xl">
          ✕
        </div>
        <div className="text-center">
          <h1 className="text-[17px] font-semibold text-text mb-1">Ошибка восстановления</h1>
          <p className="text-[13px] text-text-hint">{state.message}</p>
        </div>
        <div className="w-full max-w-sm flex flex-col gap-2">
          <button
            onClick={() => setState({ step: 'idle' })}
            className="w-full py-3 bg-primary text-white rounded-xl font-medium text-[15px] active:bg-primary/90 transition-colors"
          >
            Назад
          </button>
          <button
            onClick={onRetry}
            className="w-full py-3 border border-separator/30 text-text rounded-xl font-medium text-[15px] active:opacity-70 transition-opacity"
          >
            Повторить запуск
          </button>
        </div>
      </div>
    )
  }

  if (state.step === 'confirm-rollback') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-4 p-6">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center text-2xl">
          ⚠
        </div>
        <div className="text-center">
          <h1 className="text-[17px] font-semibold text-text mb-1">Откат версии</h1>
          <p className="text-[13px] text-text-hint">
            Выберите способ восстановления. Все локальные данные будут удалены.
          </p>
        </div>
        <div className="w-full max-w-sm flex flex-col gap-2">
          <button
            onClick={handleRestoreFromBackup}
            className="w-full py-3 bg-primary text-white rounded-xl font-medium text-[15px] active:bg-primary/90 transition-colors"
          >
            Восстановить из файла резервной копии
          </button>
          <button
            onClick={handleStartFresh}
            className="w-full py-3 bg-destructive/10 text-destructive rounded-xl font-medium text-[15px] active:opacity-70 transition-opacity"
          >
            Начать заново (без данных)
          </button>
          <button
            onClick={() => setState({ step: 'idle' })}
            className="w-full py-3 border border-separator/30 text-text rounded-xl font-medium text-[15px] active:opacity-70 transition-opacity"
          >
            Отмена
          </button>
        </div>
      </div>
    )
  }

  // idle state
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-4 p-6">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center text-2xl">
        ⚠
      </div>
      <div className="text-center">
        <h1 className="text-[17px] font-semibold text-text mb-1">Ошибка загрузки</h1>
        <p className="text-[13px] text-text-hint break-all">{error.message}</p>
      </div>

      {lastBackupMeta && (
        <div className="w-full max-w-sm bg-surface rounded-xl p-3 border border-separator/30">
          <p className="text-[12px] text-text-hint mb-1">Последняя резервная копия</p>
          <p className="text-[13px] text-text font-medium">
            Версия {lastBackupMeta.version} · {new Date(lastBackupMeta.timestamp).toLocaleString()}
          </p>
          <p className="text-[12px] text-text-hint">
            {lastBackupMeta.totalDocuments} документов
            {lastBackupMeta.attachmentSizeBytes > 0
              ? `, вложения: ${formatBytes(lastBackupMeta.attachmentSizeBytes)}`
              : ''}
          </p>
        </div>
      )}

      <div className="w-full max-w-sm flex flex-col gap-2">
        <button
          onClick={onRetry}
          className="w-full py-3 bg-primary text-white rounded-xl font-medium text-[15px] active:bg-primary/90 transition-colors"
        >
          Повторить
        </button>
        <button
          onClick={() => setState({ step: 'confirm-rollback' })}
          className="w-full py-3 bg-destructive/10 text-destructive rounded-xl font-medium text-[15px] active:opacity-70 transition-opacity"
        >
          Откатить на предыдущую версию
        </button>
      </div>
    </div>
  )
}
