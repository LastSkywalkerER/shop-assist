import { useState, useEffect } from 'react'
import { fetchRoomMembers, fetchCustomNames } from '../lib/supabase/auth'
import type { RoomMember } from '../lib/supabase/types'

interface UseRoomMembersResult {
  roomUsers: RoomMember[]
  customNames: string[]
  loading: boolean
  refetchCustomNames: () => Promise<void>
}

export function useRoomMembers(roomId: string | null): UseRoomMembersResult {
  const [roomUsers, setRoomUsers] = useState<RoomMember[]>([])
  const [customNames, setCustomNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    Promise.all([fetchRoomMembers(roomId), fetchCustomNames(roomId)])
      .then(([members, names]) => {
        setRoomUsers(members)
        setCustomNames(names)
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
