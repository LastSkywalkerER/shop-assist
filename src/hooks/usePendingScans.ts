import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import type { PrefillPayload } from '../lib/ai/pendingScansTypes'
import {
  CONSUMED_SCANS_EVENT,
  getConsumedScans,
  unmarkScanConsumed,
} from '../lib/ai/consumedScans'
import { promotePendingScan } from '../lib/ai/pendingScans'

export type PendingScanStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface PendingScan {
  id: string
  room_id: string
  created_by_user_id: string
  status: PendingScanStatus
  image_storage_path: string
  image_mime: string
  parsed_payload: unknown | null
  prefill_payload: PrefillPayload | null
  cost_usd: number | null
  error_message: string | null
  duplicate_of_expense_id: string | null
  processing_started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Subscribe to pending_receipt_scans for the current room. Direct Supabase
 * query + Realtime — no RxDB collection, no sync layer. Mirrors the channel
 * pattern used in src/lib/sync/replication.ts for *_sync tables.
 */
export function usePendingScans(roomId: string | null): PendingScan[] {
  const [rows, setRows] = useState<PendingScan[]>([])

  useEffect(() => {
    if (!roomId) {
      setRows([])
      return
    }
    let cancelled = false

    const refetch = async () => {
      const { data, error } = await supabase
        .from('pending_receipt_scans')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.warn('usePendingScans: fetch failed:', error.message)
        return
      }
      const fetched = (data ?? []) as PendingScan[]

      // Reconcile the local "consumed" registry: rows already promoted to an
      // expense whose remote delete was deferred (e.g. saved while offline).
      // Retry the delete for ones still present, drop ids already gone.
      const consumed = getConsumedScans()
      if (consumed.size > 0) {
        const presentIds = new Set(fetched.map((r) => r.id))
        for (const id of consumed) {
          if (presentIds.has(id)) {
            void promotePendingScan(id).catch(() => { /* retried on next refetch */ })
          } else {
            unmarkScanConsumed(id)
          }
        }
      }

      setRows(fetched.filter((r) => !getConsumedScans().has(r.id)))
    }
    void refetch()

    // Hide a card the instant it's marked consumed on save — don't wait for a
    // refetch (which needs the network that may currently be down).
    const onConsumedChange = () => {
      const consumed = getConsumedScans()
      setRows((prev) => prev.filter((r) => !consumed.has(r.id)))
    }
    window.addEventListener(CONSUMED_SCANS_EVENT, onConsumedChange)

    // postgres_changes payloads are partial for UPDATE/DELETE depending on
    // REPLICA IDENTITY; the safest thing is to refetch the small set on any
    // change. Volume is tiny (active scans only) so this is cheap.
    const channel = supabase
      .channel(`pending_receipt_scans:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_receipt_scans',
          filter: `room_id=eq.${roomId}`,
        },
        () => { void refetch() },
      )
      .subscribe()

    return () => {
      cancelled = true
      window.removeEventListener(CONSUMED_SCANS_EVENT, onConsumedChange)
      void supabase.removeChannel(channel)
    }
  }, [roomId])

  return rows
}
