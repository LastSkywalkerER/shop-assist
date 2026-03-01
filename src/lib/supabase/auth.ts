import { supabase } from './client'
import type { TelegramAuthData, AuthResponse, SwitchRoomResponse, InviteResponse, AcceptInviteResponse, RoomWithRole, RoomMember } from './types'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function getAuthHeader(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession()

  if (data.session) {
    // Check if token expires within 60 seconds, refresh proactively
    try {
      const payload = JSON.parse(atob(data.session.access_token.split('.')[1]))
      if (payload.exp * 1000 - Date.now() < 60_000) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (refreshed.session) data = refreshed
      }
    } catch {
      // If we can't parse, try refreshing anyway
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session) data = refreshed
    }
  }

  if (!data.session) {
    // Last resort: try refreshing
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (!refreshed.session) throw new Error('Not authenticated')
    data = refreshed
  }

  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.session!.access_token}`,
  }
}

export async function loginWithTelegram(authData: TelegramAuthData): Promise<AuthResponse> {
  const response = await fetch(`${FUNCTIONS_URL}/telegram-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authData),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Authentication failed')
  }

  const data: AuthResponse = await response.json()
  await setSessionAndStore(data)
  return data
}

export async function loginWithMiniApp(initDataRaw: string): Promise<AuthResponse> {
  const response = await fetch(`${FUNCTIONS_URL}/telegram-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initDataRaw }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Mini App authentication failed')
  }

  const data: AuthResponse = await response.json()
  await setSessionAndStore(data)
  return data
}

export async function switchRoom(roomId: string): Promise<SwitchRoomResponse> {
  const headers = await getAuthHeader()
  const response = await fetch(`${FUNCTIONS_URL}/switch-room`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ room_id: roomId }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to switch room')
  }

  const data: SwitchRoomResponse = await response.json()

  if (data.access_token && data.refresh_token) {
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
  }

  localStorage.setItem('auth_room_id', roomId)
  return data
}

export async function createInvite(roomId: string): Promise<InviteResponse> {
  const headers = await getAuthHeader()
  const response = await fetch(`${FUNCTIONS_URL}/room-invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'create', room_id: roomId }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create invite')
  }

  return response.json()
}

export async function acceptInvite(inviteCode: string): Promise<AcceptInviteResponse> {
  const headers = await getAuthHeader()
  const response = await fetch(`${FUNCTIONS_URL}/room-invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'accept', invite_code: inviteCode }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to accept invite')
  }

  return response.json()
}

export async function fetchUserRooms(): Promise<RoomWithRole[]> {
  // Ensure fresh session
  let { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    session = refreshed.session
  }
  if (!session) return []

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', session.user.id)
    .maybeSingle()

  if (!user) return []

  const { data: memberships } = await supabase
    .from('room_memberships')
    .select('room_id, role, rooms(id, name, is_personal, owner_id, created_at, updated_at)')
    .eq('user_id', user.id)

  return (memberships || []).map((m: any) => ({
    ...m.rooms,
    role: m.role,
  }))
}

async function setSessionAndStore(data: AuthResponse) {
  if (data.access_token && data.refresh_token) {
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
  }
  localStorage.setItem('auth_user', JSON.stringify(data.user))
  localStorage.setItem('auth_room_id', data.room_id)
  if (data.rooms) {
    localStorage.setItem('auth_rooms', JSON.stringify(data.rooms))
  }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
  localStorage.removeItem('auth_user')
  localStorage.removeItem('auth_room_id')
  localStorage.removeItem('auth_rooms')
}

export async function getCurrentSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function getStoredUser() {
  const userJson = localStorage.getItem('auth_user')
  return userJson ? JSON.parse(userJson) : null
}

export function getStoredRoomId(): string | null {
  return localStorage.getItem('auth_room_id')
}

export function getStoredRooms(): RoomWithRole[] {
  const roomsJson = localStorage.getItem('auth_rooms')
  return roomsJson ? JSON.parse(roomsJson) : []
}

export async function fetchRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data } = await supabase
    .from('room_memberships')
    .select('user_id, users(id, first_name, last_name, telegram_id, photo_url)')
    .eq('room_id', roomId)

  return (data || []).map((m: any) => {
    const u = m.users
    const displayName = [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.first_name || ''
    return { userId: u?.id ?? '', displayName, telegramId: u?.telegram_id ?? 0, photoUrl: u?.photo_url ?? undefined }
  }).filter((m) => m.userId)
}

export async function fetchCustomNames(roomId: string): Promise<string[]> {
  const { data } = await supabase
    .from('room_custom_names')
    .select('name')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  return (data || []).map((r: any) => r.name as string)
}

export async function saveCustomName(roomId: string, name: string): Promise<void> {
  // upsert with onConflict ignore: if (room_id, name) already exists, no error
  await supabase
    .from('room_custom_names')
    .upsert({ room_id: roomId, name }, { onConflict: 'room_id,name', ignoreDuplicates: true })
}
