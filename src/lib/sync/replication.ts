import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication'
import type { RxCollection } from 'rxdb'
import { supabase } from '../supabase/client'
import { transformRxDBToSupabase, transformSupabaseToRxDB, getTableName } from './transformers'

export interface ReplicationConfig {
  collection: RxCollection
  roomId: string
}

interface CheckpointType {
  updated_at: string
}

export async function setupCollectionReplication(
  config: ReplicationConfig
): Promise<RxReplicationState<any, CheckpointType>> {
  const { collection, roomId } = config
  const tableName = getTableName(collection.name)

  const replicationState = replicateRxCollection({
    collection,
    replicationIdentifier: `supabase-${collection.name}-${roomId}-v${localStorage.getItem(`room_sync_clear_${roomId}`) ?? '0'}`,
    pull: {
      async handler(checkpoint: CheckpointType | undefined, batchSize: number) {
        const lastUpdated = checkpoint?.updated_at || '1970-01-01T00:00:00.000Z'

        try {
          const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('room_id', roomId)
            .gt('updated_at', lastUpdated)
            .order('updated_at', { ascending: true })
            .limit(batchSize)

          if (error) {
            console.error(`Pull error for ${tableName}:`, error)
            throw error
          }

          const documents = (data || []).map(transformSupabaseToRxDB)

          return {
            documents,
            checkpoint: data && data.length > 0
              ? { updated_at: data[data.length - 1].updated_at }
              : checkpoint,
          }
        } catch (error) {
          console.error(`Pull failed for ${tableName}:`, error)
          throw error
        }
      },
    },
    push: {
      async handler(changeRows) {
        try {
          // Guard: skip push if JWT room_id no longer matches this replication's room.
          // This prevents RLS errors during room switching (JWT updates before replication stops).
          const session = await supabase.auth.getSession()
          const jwtRoomId = session.data.session?.user?.user_metadata?.room_id
          if (!jwtRoomId || jwtRoomId !== roomId) {
            return []
          }

          const rows = changeRows.map(change => {
            const doc = change.newDocumentState
            return transformRxDBToSupabase(doc as any, roomId)
          })

          const { error } = await supabase
            .from(tableName)
            .upsert(rows, {
              onConflict: 'id',
            })

          if (error) {
            if (error.code === '42501') {
              // Batch RLS violation: likely stale deletion events from a room switch
              // (old room's document IDs exist in Supabase under a different room_id).
              // Retry row-by-row so valid rows are still pushed; silently skip RLS failures.
              for (const row of rows) {
                const { error: rowError } = await supabase
                  .from(tableName)
                  .upsert([row], { onConflict: 'id' })
                if (rowError && rowError.code !== '42501') {
                  console.error(`Push error for ${tableName}:`, rowError)
                  throw rowError
                }
              }
              return []
            }
            console.error(`Push error for ${tableName}:`, error)
            throw error
          }

          return []
        } catch (error) {
          console.error(`Push failed for ${tableName}:`, error)
          throw error
        }
      },
    },
  })

  // Подписаться на Realtime изменения
  const channel = supabase
    .channel(`${tableName}_changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName,
        filter: `room_id=eq.${roomId}`,
      },
      () => {
        replicationState.reSync()
      }
    )
    .subscribe((status) => {
      // Re-sync on (re)connect so missed changes are pulled
      if (status === 'SUBSCRIBED') {
        replicationState.reSync()
      }
    })

  // Fallback polling every 30s in case Realtime misses events
  const pollInterval = setInterval(() => {
    replicationState.reSync()
  }, 30_000)

  // Сохранить channel и timer для очистки
  ;(replicationState as any).__channel = channel
  ;(replicationState as any).__pollInterval = pollInterval

  return replicationState
}

export async function stopReplication(replicationState: RxReplicationState<any, CheckpointType>) {
  // Остановить fallback polling
  const pollInterval = (replicationState as any).__pollInterval
  if (pollInterval) clearInterval(pollInterval)

  // Отписаться от Realtime
  const channel = (replicationState as any).__channel
  if (channel) {
    await supabase.removeChannel(channel)
  }

  // Остановить replication
  await replicationState.cancel()
}
