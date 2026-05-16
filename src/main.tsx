import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import 'yet-another-react-lightbox/styles.css'
import { App } from './App'
import { initTelegramApp } from './telegram/init'
import { applyFallbackTheme } from './telegram/theme'
import { getDatabase, resetDatabase, type ShopAssistDatabase } from './db/database'
import { DatabaseContext } from './db/hooks'
import { AuthProvider } from './contexts/AuthContext'
import { SyncProvider } from './contexts/SyncContext'
import { ToastProvider } from './contexts/ToastContext'
import { ConfirmDialogProvider } from './contexts/ConfirmDialogContext'
import { RecoveryScreen } from './components/RecoveryScreen'
import { restoreBackupToDb, type BackupFile } from './db/backup'
import eruda from 'eruda'

// Initialize Eruda mobile debugger (always available)
eruda.init()
console.log('🐛 Eruda debugger enabled')

const isTelegram = initTelegramApp()
if (!isTelegram) {
  applyFallbackTheme()
}

type InitState =
  | { status: 'loading' }
  | { status: 'ready'; db: ShopAssistDatabase }
  | { status: 'error'; error: Error }

function Root() {
  const [initState, setInitState] = useState<InitState>({ status: 'loading' })

  const initDb = () => {
    setInitState({ status: 'loading' })
    getDatabase()
      .then(async (db) => {
        // Apply a pending restore (set by RecoveryScreen after rollback)
        const pendingRestore = sessionStorage.getItem('pending_restore')
        if (pendingRestore) {
          sessionStorage.removeItem('pending_restore')
          try {
            const backup = JSON.parse(pendingRestore) as BackupFile
            await restoreBackupToDb(db, backup)
            console.log('Restore from backup completed')
          } catch (err) {
            console.error('Pending restore failed (non-fatal):', err)
          }
        }
        setInitState({ status: 'ready', db })
      })
      .catch((err) => {
        console.error('Database initialization failed:', err)
        setInitState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
  }

  useEffect(() => {
    initDb()
  }, [])

  if (initState.status === 'loading') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-text-hint text-[13px]">Загрузка...</div>
      </div>
    )
  }

  if (initState.status === 'error') {
    return (
      <RecoveryScreen
        error={initState.error}
        onRetry={() => {
          resetDatabase()
          initDb()
        }}
      />
    )
  }

  return (
    <StrictMode>
      <ToastProvider>
        <ConfirmDialogProvider>
          <AuthProvider>
            <DatabaseContext.Provider value={initState.db}>
              <SyncProvider>
                <App />
              </SyncProvider>
            </DatabaseContext.Provider>
          </AuthProvider>
        </ConfirmDialogProvider>
      </ToastProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
