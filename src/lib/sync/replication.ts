import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication'
import type { RxCollection } from 'rxdb'
import { supabase } from '../supabase/client'
import { transformRxDBToSupabase, transformSupabaseToRxDB, getTableName } from './transformers'
import {
  blobStoreGet,
  blobStorePut,
  blobStoreRemove,
  dataUrlToBlob,
  getPendingUploads,
  removePendingUpload,
} from '../../db/blobStore'

export interface ReplicationConfig {
  collection: RxCollection
  roomId: string
}

interface CheckpointType {
  updated_at: string
}

const ATTACHMENT_COLLECTIONS = new Set(['expenseAttachments', 'purchaseAttachments'])
const STORAGE_BUCKET = 'sync-attachments'

function getStoragePath(collectionName: string, roomId: string, id: string): string {
  const folder = collectionName === 'expenseAttachments' ? 'expense_attachments' : 'purchase_attachments'
  return `${roomId}/${folder}/${id}`
}

// Suppress pushing _deleted documents for a period after room-switch clears.
// d.remove() in the room-switch handler creates deletion change events that the
// new replication would push to Supabase — corrupting real server data by setting
// _deleted=true on records that actually belong to the target room.
let pushDeletionsSuppressedUntil = 0

export function suppressPushDeletions(durationMs: number) {
  pushDeletionsSuppressedUntil = Date.now() + durationMs
}

export async function setupCollectionReplication(
  config: ReplicationConfig
): Promise<RxReplicationState<any, CheckpointType>> {
  const { collection, roomId } = config
  const tableName = getTableName(collection.name)
  const isAttachment = ATTACHMENT_COLLECTIONS.has(collection.name)

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

          let documents: any[]

          if (isAttachment) {
            documents = await Promise.all((data || []).map(async (row) => {
              if (!row._deleted) {
                await hydrateAttachmentBlob(row)
              }
              const doc = transformSupabaseToRxDB(row)
              delete doc.dataUrl
              if (collection.name === 'purchaseAttachments') {
                if (!doc.mimeType) doc.mimeType = 'image/jpeg'
                if (doc.size == null) doc.size = 0
              }
              return doc
            }))
          } else {
            documents = (data || []).map(transformSupabaseToRxDB)
          }

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
          const session = await supabase.auth.getSession()
          const jwtRoomId = session.data.session?.user?.user_metadata?.room_id
          if (!jwtRoomId || jwtRoomId !== roomId) {
            return []
          }

          let effectiveChanges = changeRows
          if (Date.now() < pushDeletionsSuppressedUntil) {
            effectiveChanges = changeRows.filter(c => !c.newDocumentState._deleted)
            if (effectiveChanges.length === 0) return []
          }

          if (isAttachment) {
            return await pushAttachmentChanges(effectiveChanges, collection, roomId, tableName)
          }

          const rows = effectiveChanges.map(change => {
            const doc = change.newDocumentState
            const row = transformRxDBToSupabase(doc as any, roomId)
            // doc.remove() does not bump updatedAt, so without this stamp the
            // tombstone row keeps its old updated_at and other clients' pull
            // queries (WHERE updated_at > checkpoint) never see the deletion.
            if (row._deleted) row.updated_at = new Date().toISOString()
            return row
          })

          const { error } = await supabase
            .from(tableName)
            .upsert(rows, {
              onConflict: 'id',
            })

          if (error) {
            if (error.code === '42501') {
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
      if (status === 'SUBSCRIBED') {
        replicationState.reSync()
      }
    })

  const pollInterval = setInterval(() => {
    replicationState.reSync()
  }, 30_000)

  ;(replicationState as any).__channel = channel
  ;(replicationState as any).__pollInterval = pollInterval

  return replicationState
}

export async function stopReplication(replicationState: RxReplicationState<any, CheckpointType>) {
  const pollInterval = (replicationState as any).__pollInterval
  if (pollInterval) clearInterval(pollInterval)

  const channel = (replicationState as any).__channel
  if (channel) {
    await supabase.removeChannel(channel)
  }

  await replicationState.cancel()
}

// ---------------------------------------------------------------------------
// One-time migration: move legacy base64 data_url → Supabase Storage
// ---------------------------------------------------------------------------

const LEGACY_MIGRATION_PREFIX = 'legacy_attachments_migrated_'

interface AttachmentCollections {
  expenseAttachments?: RxCollection
  purchaseAttachments?: RxCollection
}

export async function migrateLegacyAttachments(
  roomId: string,
  collections: AttachmentCollections,
): Promise<number> {
  const flagKey = `${LEGACY_MIGRATION_PREFIX}${roomId}`
  if (localStorage.getItem(flagKey) === 'done') return 0

  const targets = [
    { table: 'expense_attachments_sync' as const, collection: collections.expenseAttachments, folder: 'expense_attachments' },
    { table: 'purchase_attachments_sync' as const, collection: collections.purchaseAttachments, folder: 'purchase_attachments' },
  ]

  let migrated = 0

  for (const { table, collection, folder } of targets) {
    if (!collection) continue

    const { data: rows, error } = await supabase
      .from(table)
      .select('id')
      .eq('room_id', roomId)
      .is('storage_path', null)
      .eq('_deleted', false)

    if (error || !rows || rows.length === 0) continue

    for (const { id } of rows) {
      try {
        let blob = await blobStoreGet(id)

        if (!blob) {
          const { data: fullRow } = await supabase
            .from(table)
            .select('data_url')
            .eq('id', id)
            .single()
          if (fullRow?.data_url?.startsWith('data:')) {
            blob = dataUrlToBlob(fullRow.data_url)
            await blobStorePut(id, blob)
          }
        }

        if (!blob) continue

        const storagePath = `${roomId}/${folder}/${id}`

        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, blob, {
            upsert: true,
            contentType: blob.type || 'application/octet-stream',
          })
        if (uploadErr) {
          console.error(`Legacy migration: upload failed for ${id}:`, uploadErr)
          continue
        }

        const { error: updateErr } = await supabase
          .from(table)
          .update({ storage_path: storagePath, data_url: '' })
          .eq('id', id)
        if (updateErr) {
          console.error(`Legacy migration: row update failed for ${id}:`, updateErr)
          continue
        }

        try {
          const rxDoc = await collection.findOne(id).exec()
          if (rxDoc) await rxDoc.patch({ storagePath })
        } catch { /* local patch is best-effort */ }

        migrated++
      } catch (e) {
        console.error(`Legacy migration: error for ${id}:`, e)
      }
    }
  }

  localStorage.setItem(flagKey, 'done')
  return migrated
}

// ---------------------------------------------------------------------------
// Attachment-specific helpers
// ---------------------------------------------------------------------------

async function hydrateAttachmentBlob(row: any): Promise<void> {
  const existing = await blobStoreGet(row.id)
  if (existing) return

  if (row.storage_path) {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(row.storage_path)
      if (!error && data) {
        await blobStorePut(row.id, data)
      } else {
        console.warn(`Failed to download attachment ${row.id}:`, error)
      }
    } catch (e) {
      console.warn(`Failed to download attachment ${row.id}:`, e)
    }
  } else if (row.data_url && typeof row.data_url === 'string' && row.data_url.startsWith('data:')) {
    try {
      const blob = dataUrlToBlob(row.data_url)
      await blobStorePut(row.id, blob)
    } catch (e) {
      console.warn(`Failed to decode legacy attachment ${row.id}:`, e)
    }
  }
}

async function pushAttachmentChanges(
  changeRows: any[],
  collection: RxCollection,
  roomId: string,
  tableName: string,
): Promise<any[]> {
  const pendingUploads = getPendingUploads()

  for (const change of changeRows) {
    const doc = change.newDocumentState

    if (doc._deleted) {
      const storagePath = doc.storagePath || getStoragePath(collection.name, roomId, doc.id)
      const row = transformRxDBToSupabase(doc as any, roomId)
      row.data_url = ''
      // See note on the non-attachment push path: bump updated_at so the
      // tombstone surfaces in other clients' pull queries.
      row.updated_at = new Date().toISOString()

      const { error } = await supabase.from(tableName).upsert([row], { onConflict: 'id' })
      if (error && error.code !== '42501') {
        console.error(`Push delete error for ${tableName}:`, error)
      }
      supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {})
      blobStoreRemove(doc.id).catch(() => {})
      removePendingUpload(doc.id)
      continue
    }

    let storagePath: string | undefined = doc.storagePath

    if (pendingUploads.has(doc.id)) {
      const blob = await blobStoreGet(doc.id)
      if (blob) {
        storagePath = getStoragePath(collection.name, roomId, doc.id)
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, blob, {
            upsert: true,
            contentType: doc.mimeType || 'application/octet-stream',
          })
        if (uploadError) {
          console.error(`Failed to upload attachment ${doc.id}:`, uploadError)
          throw uploadError
        }
      }
    }

    const row = transformRxDBToSupabase(doc as any, roomId)
    row.data_url = ''
    if (storagePath) row.storage_path = storagePath

    const { error } = await supabase.from(tableName).upsert([row], { onConflict: 'id' })
    if (error) {
      if (error.code === '42501') continue
      console.error(`Push error for ${tableName}:`, error)
      throw error
    }

    if (pendingUploads.has(doc.id) && storagePath) {
      removePendingUpload(doc.id)
      try {
        const rxDoc = await collection.findOne(doc.id).exec()
        if (rxDoc) {
          await rxDoc.patch({ storagePath })
        }
      } catch (e) {
        console.warn(`Failed to update storagePath for ${doc.id}:`, e)
      }
    }
  }

  return []
}
