import { useState } from 'react'
import { useDatabase } from '../../db/hooks'
import { getDatabaseVersion } from '../../db/version'
import {
  createBackupFromDb,
  downloadBackup,
  pickAndParseBackupFile,
  restoreBackupToDb,
  getLastBackupMeta,
  formatBytes,
  type BackupFile,
} from '../../db/backup'
import packageJson from '../../../package.json'

type BackupState = 'idle' | 'exporting' | 'confirm-restore' | 'restoring'

export function BackupSection() {
  const db = useDatabase()
  const [state, setState] = useState<BackupState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [pendingBackup, setPendingBackup] = useState<BackupFile | null>(null)

  const lastBackupMeta = getLastBackupMeta()

  const handleCreateBackup = async () => {
    if (!db) return
    setState('exporting')
    setMessage(null)
    try {
      const backup = await createBackupFromDb(db, packageJson.version, getDatabaseVersion())
      const sizeBytes = downloadBackup(backup)
      const attachmentNote =
        backup.metadata.attachmentSizeBytes > 0
          ? `, вложения: ${formatBytes(backup.metadata.attachmentSizeBytes)}`
          : ''
      setMessage(
        `✅ Резервная копия создана: ${backup.metadata.totalDocuments} документов, ${formatBytes(sizeBytes)}${attachmentNote}`,
      )
    } catch (err) {
      setMessage(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setState('idle')
    }
  }

  const handlePickRestore = async () => {
    setMessage(null)
    try {
      const backup = await pickAndParseBackupFile()
      setPendingBackup(backup)
      setState('confirm-restore')
    } catch (err) {
      if (err instanceof Error && err.message === 'File selection cancelled') return
      setMessage(`❌ Неверный файл: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleConfirmRestore = async () => {
    if (!db || !pendingBackup) return
    setState('restoring')
    setMessage(null)
    try {
      const { restored, skipped } = await restoreBackupToDb(db, pendingBackup)
      const skippedNote = skipped.length > 0 ? ` Пропущено: ${skipped.join(', ')}.` : ''
      setMessage(`✅ Восстановлено ${restored} документов.${skippedNote}`)
    } catch (err) {
      setMessage(`❌ Ошибка восстановления: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPendingBackup(null)
      setState('idle')
    }
  }

  const handleCancelRestore = () => {
    setPendingBackup(null)
    setState('idle')
  }

  const isWorking = state === 'exporting' || state === 'restoring'

  return (
    <section className="mb-6">
      <h2 className="text-[20px] font-semibold text-text mb-4">Резервные копии</h2>

      <div className="bg-surface rounded-xl p-4 border border-separator/30 space-y-3">
        {lastBackupMeta && (
          <div className="px-3 py-2 bg-bg-secondary rounded-lg">
            <p className="text-[12px] text-text-hint">Последняя резервная копия</p>
            <p className="text-[13px] text-text">
              Версия {lastBackupMeta.version} ·{' '}
              {new Date(lastBackupMeta.timestamp).toLocaleString()}
            </p>
            <p className="text-[12px] text-text-hint">
              {lastBackupMeta.totalDocuments} документов
              {lastBackupMeta.attachmentSizeBytes > 0
                ? `, вложения: ${formatBytes(lastBackupMeta.attachmentSizeBytes)}`
                : ''}
            </p>
          </div>
        )}

        {message && (
          <div className="px-3 py-2 bg-bg-secondary rounded-lg">
            <p className="text-[13px] text-text">{message}</p>
          </div>
        )}

        {state === 'confirm-restore' && pendingBackup && (
          <div className="px-3 py-3 bg-destructive/5 border border-destructive/20 rounded-xl">
            <p className="text-[13px] text-text font-medium mb-1">Подтвердите восстановление</p>
            <p className="text-[12px] text-text-hint mb-1">
              Все текущие данные будут заменены резервной копией от{' '}
              {new Date(pendingBackup.metadata.timestamp).toLocaleString()} (
              {pendingBackup.metadata.totalDocuments} документов, версия{' '}
              {pendingBackup.metadata.version}).
            </p>
            {pendingBackup.metadata.version < getDatabaseVersion() && (
              <p className="text-[12px] text-amber-600 mb-2">
                ⚠ Версия резервной копии ниже текущей — некоторые поля могут отсутствовать.
              </p>
            )}
            <p className="text-[12px] text-text-hint mb-3">
              Если синхронизация включена, восстановленные данные будут отправлены на сервер.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancelRestore}
                className="flex-1 py-2 rounded-lg border border-separator/30 text-[14px] text-text active:opacity-70 transition-opacity"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmRestore}
                className="flex-1 py-2 rounded-lg bg-destructive text-white text-[14px] font-medium active:opacity-80 transition-opacity"
              >
                Восстановить
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleCreateBackup}
          disabled={isWorking || !db}
          className="w-full px-4 py-2.5 bg-primary text-white rounded-lg font-medium text-[15px] active:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {state === 'exporting' ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Создание...
            </>
          ) : (
            'Скачать резервную копию'
          )}
        </button>

        <button
          onClick={handlePickRestore}
          disabled={isWorking || !db || state === 'confirm-restore'}
          className="w-full px-4 py-2.5 bg-bg-secondary text-text rounded-lg font-medium text-[15px] border border-separator/30 active:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {state === 'restoring' ? (
            <>
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Восстановление...
            </>
          ) : (
            'Восстановить из файла'
          )}
        </button>
      </div>
    </section>
  )
}
