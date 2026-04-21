import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication'
import type { RxCollection } from 'rxdb'
import { supabase } from '../supabase/client'
import { transformSupabaseToRxDB } from './transformers'

// Pull-only replication for the global `currency_rates_sync` table.
// Unlike room-scoped collections, this one has no room_id filter and no push
// handler — writes happen exclusively via the fetch-nbrb-rates edge function
// running under service_role. Every authenticated client pulls the same data.

interface CheckpointType {
  updated_at: string
}

const TABLE_NAME = 'currency_rates_sync'
const POLL_INTERVAL_MS = 60 * 60 * 1000 // 1 hour — rates update at most once per business day

export async function setupCurrencyRatesReplication(
  collection: RxCollection,
): Promise<RxReplicationState<any, CheckpointType>> {
  const replicationState = replicateRxCollection({
    collection,
    replicationIdentifier: `supabase-${TABLE_NAME}-pull`,
    pull: {
      async handler(checkpoint: CheckpointType | undefined, batchSize: number) {
        const lastUpdated = checkpoint?.updated_at || '1970-01-01T00:00:00.000Z'

        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select('*')
          .gt('updated_at', lastUpdated)
          .order('updated_at', { ascending: true })
          .limit(batchSize)

        if (error) {
          console.error(`Pull error for ${TABLE_NAME}:`, error)
          throw error
        }

        const documents = (data || []).map(transformSupabaseToRxDB)
        return {
          documents,
          checkpoint: data && data.length > 0
            ? { updated_at: data[data.length - 1].updated_at }
            : checkpoint,
        }
      },
    },
  })

  const pollInterval = setInterval(() => {
    replicationState.reSync()
  }, POLL_INTERVAL_MS)

  ;(replicationState as any).__pollInterval = pollInterval

  return replicationState
}

export async function stopCurrencyRatesReplication(
  replicationState: RxReplicationState<any, CheckpointType>,
): Promise<void> {
  const pollInterval = (replicationState as any).__pollInterval
  if (pollInterval) clearInterval(pollInterval)
  await replicationState.cancel()
}
