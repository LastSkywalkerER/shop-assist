import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './App'
import { initTelegramApp } from './telegram/init'
import { applyFallbackTheme } from './telegram/theme'
import { getDatabase, type ShopAssistDatabase } from './db/database'
import { DatabaseContext } from './db/hooks'
import { AuthProvider } from './contexts/AuthContext'
import { SyncProvider } from './contexts/SyncContext'

const isTelegram = initTelegramApp()
if (!isTelegram) {
  applyFallbackTheme()
}

function Root() {
  const [db, setDb] = useState<ShopAssistDatabase | null>(null)

  useEffect(() => {
    getDatabase().then(setDb)
  }, [])

  if (!db) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-secondary gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-text-hint text-[13px]">Загрузка...</div>
      </div>
    )
  }

  return (
    <StrictMode>
      <AuthProvider>
        <DatabaseContext.Provider value={db}>
          <SyncProvider>
            <App />
          </SyncProvider>
        </DatabaseContext.Provider>
      </AuthProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
