import { useState, useEffect } from 'react'
import { fetchRoomMembers, fetchCustomNames } from '../lib/supabase/auth'
import { readCachedRoomMembers, writeCachedRoomMembers } from '../lib/supabase/roomMembersCache'
import type { RoomMember } from '../lib/supabase/types'

interface UseRoomMembersResult {
  roomUsers: RoomMember[]
  customNames: string[]
  loading: boolean
  refetchCustomNames: () => Promise<void>
}

export function useRoomMembers(roomId: string | null): UseRoomMembersResult {
  const [roomUsers, setRoomUsers] = useState<RoomMember[]>(() =>
    roomId ? readCachedRoomMembers(roomId) : [],
  )
  const [customNames, setCustomNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) return
    // Show the last known roster immediately — the fetch below refreshes it,
    // and offline it is all we get.
    setRoomUsers(readCachedRoomMembers(roomId))
    setLoading(true)
    Promise.all([fetchRoomMembers(roomId), fetchCustomNames(roomId)])
      .then(([members, names]) => {
        setRoomUsers(members)
        setCustomNames(names)
        writeCachedRoomMembers(roomId, members)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [roomId])

  const refetchCustomNames = async () => {
    if (!roomId) return
    try {
      const names = await fetchCustomNames(roomId)
      setCustomNames(names)
    } catch {}
  }

  return { roomUsers, customNames, loading, refetchCustomNames }
}
