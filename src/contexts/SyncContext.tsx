import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { RxReplicationState } from 'rxdb/plugins/replication'
import { useDatabase } from '../db/hooks'
import { useAuth } from './AuthContext'
import { setupCollectionReplication, stopReplication } from '../lib/sync/replication'

interface SyncContextType {
  isSyncing: boolean
  isSyncEnabled: boolean
  lastSyncTime: Date | null
  syncError: string | null
  startSync: () => Promise<void>
  stopSync: () => Promise<void>
  toggleSync: (enabled: boolean) => Promise<void>
}

const SyncContext = createContext<SyncContextType | null>(null)

const COLLECTION_NAMES = [
  'products',
  'stores',
  'purchases',
  'expenseCategories',
  'expenses',
  'receipts',
  'receiptItems',
  'expenseAttachments',
]

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDatabase()
  const { isAuthenticated, roomId } = useAuth()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSyncEnabled, setIsSyncEnabled] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [replications, setReplications] = useState<Array<RxReplicationState<any, { updated_at: string }>>>([])

  // Auto-enable sync when authenticated (unless explicitly disabled)
  useEffect(() => {
    const savedValue = localStorage.getItem('sync_enabled')
    const syncEnabled = savedValue !== 'false'
    setIsSyncEnabled(syncEnabled)

    if (syncEnabled && isAuthenticated && roomId && db) {
      localStorage.setItem('sync_enabled', 'true')
      startSync()
    }
  }, [isAuthenticated, roomId, db])

  const startSync = async () => {
    if (!db || !roomId || !isAuthenticated) {
      setSyncError('Необходима авторизация для синхронизации')
      return
    }

    if (isSyncing) {
      return
    }

    try {
      setIsSyncing(true)
      setSyncError(null)

      const replicationStates: Array<RxReplicationState<any, { updated_at: string }>> = []

      // Настроить replication для всех коллекций
      for (const collectionName of COLLECTION_NAMES) {
        const collection = db[collectionName as keyof typeof db]
        if (!collection) continue

        const replicationState = await setupCollectionReplication({
          collection,
          roomId,
        })

        replicationStates.push(replicationState)

        // Обновить lastSyncTime при активности
        replicationState.active$.subscribe((active: boolean) => {
          if (active) {
            setLastSyncTime(new Date())
          }
        })

        // Обработка ошибок
        replicationState.error$.subscribe((error: any) => {
          if (error) {
            console.error(`Replication error for ${collectionName}:`, error)
            setSyncError(`Ошибка синхронизации: ${error.message}`)
          }
        })
      }

      setReplications(replicationStates)
      console.log(`✅ Синхронизация запущена для ${replicationStates.length} коллекций`)
    } catch (error) {
      console.error('Failed to start sync:', error)
      setSyncError(error instanceof Error ? error.message : 'Ошибка запуска синхронизации')
      setIsSyncing(false)
    }
  }

  const stopSync = async () => {
    try {
      // Остановить все replication states
      for (const replicationState of replications) {
        await stopReplication(replicationState)
      }

      setReplications([])
      setIsSyncing(false)
      console.log('✅ Синхронизация остановлена')
    } catch (error) {
      console.error('Failed to stop sync:', error)
      setSyncError(error instanceof Error ? error.message : 'Ошибка остановки синхронизации')
    }
  }

  const toggleSync = async (enabled: boolean) => {
    setIsSyncEnabled(enabled)
    localStorage.setItem('sync_enabled', enabled.toString())

    if (enabled) {
      await startSync()
    } else {
      await stopSync()
    }
  }

  return (
    <SyncContext.Provider
      value={{
        isSyncing,
        isSyncEnabled,
        lastSyncTime,
        syncError,
        startSync,
        stopSync,
        toggleSync,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync() {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSync must be used within SyncProvider')
  }
  return context
}
