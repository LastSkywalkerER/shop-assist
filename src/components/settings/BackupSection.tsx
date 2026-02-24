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
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          Резервные копии
        </span>
      </div>

      {lastBackupMeta && (
        <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
          <div className="px-4 py-3">
            <p className="text-[12px] text-text-hint mb-0.5">Последняя резервная копия</p>
            <p className="text-[14px] text-text">
              Версия {lastBackupMeta.version} · {new Date(lastBackupMeta.timestamp).toLocaleString()}
            </p>
            <p className="text-[12px] text-text-hint mt-0.5">
              {lastBackupMeta.totalDocuments} документов
              {lastBackupMeta.attachmentSizeBytes > 0
                ? `, вложения: ${formatBytes(lastBackupMeta.attachmentSizeBytes)}`
                : ''}
            </p>
          </div>
        </div>
      )}

      {message && (
        <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
          <div className="px-4 py-3">
            <p className="text-[13px] text-text">{message}</p>
          </div>
        </div>
      )}

      {state === 'confirm-restore' && pendingBackup && (
        <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-destructive/20">
          <div className="px-4 py-3">
            <p className="text-[14px] text-text font-medium mb-1">Подтвердите восстановление</p>
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
                className="flex-1 py-2 rounded-xl border border-separator/30 text-[14px] text-text active:opacity-70 transition-opacity"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmRestore}
                className="flex-1 py-2 rounded-xl bg-destructive text-white text-[14px] font-medium active:opacity-80 transition-opacity"
              >
                Восстановить
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
        <button
          onClick={handleCreateBackup}
          disabled={isWorking || !db}
          className="w-full px-4 py-3 text-[15px] text-primary-text font-medium active:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {state === 'exporting' ? (
            <>
              <div className="w-4 h-4 border-2 border-primary-text border-t-transparent rounded-full animate-spin" />
              Создание...
            </>
          ) : (
            'Скачать резервную копию'
          )}
        </button>
      </div>

      <div className="mx-4 mt-3 glass rounded-2xl overflow-hidden border border-separator/15">
        <button
          onClick={handlePickRestore}
          disabled={isWorking || !db || state === 'confirm-restore'}
          className="w-full px-4 py-3 text-[15px] text-text font-medium active:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
