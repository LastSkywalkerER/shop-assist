import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useRoomMembers } from './useRoomMembers'

export interface RoomMemberNames {
  /** Case-insensitive membership test for a participant name. */
  isRoomMember: (name: string) => boolean
  /**
   * False while the roster is unknown (signed out, or a first launch that never
   * reached Supabase). Callers must fall back to their old behaviour instead of
   * treating everybody as an outsider.
   */
  known: boolean
}

/**
 * Membership test for participant names against the current room's roster.
 *
 * Split participants are free-text names; only the ones that match a room
 * member are "our" people, and only their money is the room's own spending.
 */
export function useRoomMemberNames(): RoomMemberNames {
  const { roomId } = useAuth()
  const { roomUsers } = useRoomMembers(roomId)

  const namesKey = roomUsers.map((u) => u.displayName).join('|')

  return useMemo(() => {
    const names = new Set(
      roomUsers.map((u) => u.displayName.trim().toLowerCase()).filter(Boolean),
    )
    return {
      known: names.size > 0,
      isRoomMember: (name: string) => names.has(name.trim().toLowerCase()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])
}
