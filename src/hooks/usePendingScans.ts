import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import type { PrefillPayload } from '../lib/ai/pendingScansTypes'

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
      setRows((data ?? []) as PendingScan[])
    }
    void refetch()

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
      void supabase.removeChannel(channel)
    }
  }, [roomId])

  return rows
}
