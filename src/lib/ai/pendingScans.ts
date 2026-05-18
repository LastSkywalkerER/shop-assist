// Client helpers for the async receipt OCR flow. Pending scans live in
// Supabase only (no RxDB collection) — these helpers wrap the upload + row
// insert + edge-function invocation, plus the cleanup paths for retry and
// cancellation. See docs/AI_FEATURE_NOTES.md → "Async scan flow".

import { supabase } from '../supabase/client'
import { resizeImage } from './ocrPipeline'

const BUCKET = 'sync-attachments'

export class PendingScanError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'PendingScanError'
    this.code = code
  }
}

function functionsUrl(path: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`
}

async function authHeader(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession()
  if (data.session) {
    try {
      const payload = JSON.parse(atob(data.session.access_token.split('.')[1]))
      if (payload.exp * 1000 - Date.now() < 60_000) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (refreshed.session) data = refreshed
      }
    } catch {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session) data = refreshed
    }
  }
  if (!data.session) throw new PendingScanError('Не авторизованы', 'unauthorized')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.session.access_token}`,
  }
}

export interface StartScanArgs {
  blob: Blob
  roomId: string
  userId: string
}

export interface StartScanResult {
  scanId: string
  storagePath: string
}

/**
 * Resize + upload the captured image, insert a pending row, then kick off
 * the background OCR pipeline. Returns once the orchestrator has accepted
 * the job; the pipeline result arrives later via Realtime.
 */
export async function startScan({ blob, roomId, userId }: StartScanArgs): Promise<StartScanResult> {
  const scanId = crypto.randomUUID()
  const resized = await resizeImage(blob)
  const file = resized instanceof File
    ? resized
    : new File([resized], `receipt-${Date.now()}.jpg`, { type: resized.type || 'image/jpeg' })
  const storagePath = `${roomId}/pending_scans/${scanId}.jpg`

  const uploadRes = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  })
  if (uploadRes.error) {
    throw new PendingScanError(`Не удалось загрузить чек: ${uploadRes.error.message}`, 'upload_failed')
  }

  const { error: insertErr } = await supabase.from('pending_receipt_scans').insert({
    id: scanId,
    room_id: roomId,
    created_by_user_id: userId,
    status: 'pending',
    image_storage_path: storagePath,
    image_mime: file.type || 'image/jpeg',
  })
  if (insertErr) {
    // Best-effort: clean up the orphaned storage object.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
    throw new PendingScanError(`Не удалось создать запись: ${insertErr.message}`, 'insert_failed')
  }

  const headers = await authHeader()
  const res = await fetch(functionsUrl('start-receipt-scan'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ scanId }),
  })
  if (!res.ok) {
    let parsed: { error?: string; scope?: string } = {}
    try { parsed = await res.json() } catch { /* ignore */ }
    // Don't delete the pending row — the user can retry from the list row.
    throw new PendingScanError(parsed.error || `Ошибка запуска (HTTP ${res.status})`, 'kickoff_failed')
  }

  return { scanId, storagePath }
}

export async function retryScan(scanId: string): Promise<void> {
  const headers = await authHeader()
  const res = await fetch(functionsUrl('start-receipt-scan'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ scanId, force: true }),
  })
  if (!res.ok) {
    let parsed: { error?: string } = {}
    try { parsed = await res.json() } catch { /* ignore */ }
    throw new PendingScanError(parsed.error || `Ошибка повтора (HTTP ${res.status})`, 'retry_failed')
  }
}

/**
 * Delete the pending row AND the storage object. Used on cancel from the
 * review screen and on the row's Delete button after a failure. Always
 * tries both — a failure to remove the storage object is logged but
 * doesn't surface to the user.
 */
export async function deletePendingScan(scanId: string, storagePath?: string | null): Promise<void> {
  const { error: rowErr } = await supabase
    .from('pending_receipt_scans')
    .delete()
    .eq('id', scanId)
  if (rowErr) throw new PendingScanError(rowErr.message, 'delete_failed')
  if (storagePath) {
    const { error: storageErr } = await supabase.storage.from(BUCKET).remove([storagePath])
    if (storageErr) console.warn('Failed to remove pending scan blob:', storageErr.message)
  }
}

/**
 * Promote the pending scan's storage object to an expense attachment by
 * leaving the file in place and just deleting the row. The caller is
 * expected to create an expense_attachments_sync row pointing at the same
 * `storage_path` value, which is fine because the path is still under the
 * room's folder and RLS only checks the room prefix.
 */
export async function promotePendingScan(scanId: string): Promise<void> {
  const { error } = await supabase
    .from('pending_receipt_scans')
    .delete()
    .eq('id', scanId)
  if (error) throw new PendingScanError(error.message, 'promote_failed')
}
