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
    replicationIdentifier: `supabase-${collection.name}`,
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
        // Перезапустить pull при изменениях
        replicationState.reSync()
      }
    )
    .subscribe()

  // Сохранить channel для очистки
  ;(replicationState as any).__channel = channel

  return replicationState
}

export async function stopReplication(replicationState: RxReplicationState<any, CheckpointType>) {
  // Отписаться от Realtime
  const channel = (replicationState as any).__channel
  if (channel) {
    await supabase.removeChannel(channel)
  }

  // Остановить replication
  await replicationState.cancel()
}
