import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import type { RxReplicationState } from 'rxdb/plugins/replication'
import { useDatabase } from '../db/hooks'
import { useAuth } from './AuthContext'
import { setupCollectionReplication, stopReplication, suppressPushDeletions } from '../lib/sync/replication'

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
  const replicationsRef = useRef<Array<RxReplicationState<any, { updated_at: string }>>>([])
  const prevRoomIdRef = useRef<string | null>(null)

  const stopSyncInternal = useCallback(async () => {
    // Clear ref immediately so startSyncInternal cannot see stale replications
    // even if individual cancel calls fail below.
    const toStop = replicationsRef.current
    replicationsRef.current = []
    setIsSyncing(false)
    for (const replicationState of toStop) {
      try {
        await stopReplication(replicationState)
      } catch (error) {
        console.error('Failed to stop replication:', error)
      }
    }
  }, [])

  const startSyncInternal = useCallback(async () => {
    if (!db || !roomId || !isAuthenticated) {
      setSyncError('Authentication required for sync')
      return
    }

    if (replicationsRef.current.length > 0) {
      await stopSyncInternal()
    }

    try {
      setIsSyncing(true)
      setSyncError(null)

      const replicationStates: Array<RxReplicationState<any, { updated_at: string }>> = []

      for (const collectionName of COLLECTION_NAMES) {
        const collection = db[collectionName as keyof typeof db]
        if (!collection) continue

        const replicationState = await setupCollectionReplication({
          collection,
          roomId,
        })

        replicationStates.push(replicationState)

        replicationState.active$.subscribe((active: boolean) => {
          if (active) {
            setLastSyncTime(new Date())
          }
        })

        replicationState.error$.subscribe((error: any) => {
          if (error) {
            console.error(`Replication error for ${collectionName}:`, error)
            setSyncError(`Sync error: ${error.message}`)
          }
        })
      }

      replicationsRef.current = replicationStates
      console.log(`Sync started for ${replicationStates.length} collections`)
    } catch (error) {
      console.error('Failed to start sync:', error)
      setSyncError(error instanceof Error ? error.message : 'Failed to start sync')
      setIsSyncing(false)
    }
  }, [db, roomId, isAuthenticated, stopSyncInternal])

  // Handle room switching: stop sync, clear local data, restart
  useEffect(() => {
    if (!roomId || !db || !isAuthenticated) return

    const handleRoomChange = async () => {
      const prevRoomId = prevRoomIdRef.current
      prevRoomIdRef.current = roomId

      if (prevRoomId && prevRoomId !== roomId) {
        console.log(`Room switched: ${prevRoomId} -> ${roomId}`)
        await stopSyncInternal()

        // Suppress _deleted pushes so that d.remove() deletion events below
        // don't get pushed to Supabase and corrupt real server data.
        // 30s is more than enough for the initial pull to complete.
        suppressPushDeletions(30_000)

        // Bump the clear epoch for the new room so its replicationIdentifier changes.
        // This forces a fresh checkpoint (pull from epoch) after local data is wiped,
        // preventing the stale checkpoint from skipping already-known data.
        const prevEpoch = parseInt(localStorage.getItem(`room_sync_clear_${roomId}`) ?? '0')
        localStorage.setItem(`room_sync_clear_${roomId}`, (prevEpoch + 1).toString())

        // Clear all local collections for fresh sync from new room
        for (const collectionName of COLLECTION_NAMES) {
          const collection = db[collectionName as keyof typeof db]
          if (!collection) continue
          try {
            const docs = await collection.find().exec()
            await Promise.all(docs.map((d: any) => d.remove()))
          } catch (e) {
            console.error(`Failed to clear ${collectionName}:`, e)
          }
        }

        if (isSyncEnabled) {
          await startSyncInternal()
        }
      }
    }

    handleRoomChange()
  }, [roomId, db, isAuthenticated])

  // Auto-enable sync when authenticated
  useEffect(() => {
    const savedValue = localStorage.getItem('sync_enabled')
    const syncEnabled = savedValue !== 'false'
    setIsSyncEnabled(syncEnabled)

    if (syncEnabled && isAuthenticated && roomId && db) {
      localStorage.setItem('sync_enabled', 'true')
      prevRoomIdRef.current = roomId
      startSyncInternal()
    }
  }, [isAuthenticated, db])

  const startSync = async () => {
    await startSyncInternal()
  }

  const stopSync = async () => {
    await stopSyncInternal()
  }

  const toggleSync = async (enabled: boolean) => {
    setIsSyncEnabled(enabled)
    localStorage.setItem('sync_enabled', enabled.toString())

    if (enabled) {
      await startSyncInternal()
    } else {
      await stopSyncInternal()
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
