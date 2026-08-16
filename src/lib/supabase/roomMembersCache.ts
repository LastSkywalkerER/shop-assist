/**
 * Local cache of a room's member list.
 *
 * Room membership lives in Supabase, but the analytics screens need it while
 * offline (the rest of their data comes from RxDB). Caching the last known
 * roster keeps those screens correct on a cold, offline start instead of
 * silently treating every participant as an outsider.
 */
import type { RoomMember } from './types'

const KEY_PREFIX = 'room_members:'

function storageKey(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`
}

export function readCachedRoomMembers(roomId: string): RoomMember[] {
  try {
    const raw = localStorage.getItem(storageKey(roomId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RoomMember[]) : []
  } catch {
    return []
  }
}

export function writeCachedRoomMembers(roomId: string, members: RoomMember[]): void {
  try {
    localStorage.setItem(storageKey(roomId), JSON.stringify(members))
  } catch {
    // Quota or private-mode failures are non-fatal: the live fetch still works.
  }
}
