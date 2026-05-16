import { supabase } from './client'
import type { TelegramAuthData, AuthResponse, SwitchRoomResponse, InviteResponse, AcceptInviteResponse, RoomWithRole, RoomMember, AccountContext } from './types'

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

// ---------------------------------------------------------------------------
// Email / Google sign-in & linking
// ---------------------------------------------------------------------------

export interface EmailSignUpResult {
  needsConfirmation: boolean
}

export async function signUpWithEmail(email: string, password: string, displayName?: string): Promise<EmailSignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: displayName ? { display_name: displayName, full_name: displayName } : undefined },
  })
  if (error) throw error
  // When "Confirm email" is enabled, session is null until the user clicks the link.
  return { needsConfirmation: !data.session }
}

export async function signInWithEmail(email: string, password: string): Promise<AccountContext> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return completeAccount()
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
  // Redirect happens; flow continues in onAuthStateChange after callback.
}

export async function linkGoogleProvider(): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function setEmailPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email, password })
  if (error) throw error
  // Email change usually requires confirmation; password is updated immediately.
  // public.users.email is synced by completeAccount() once auth.users.email
  // actually changes (after confirmation).
}

export async function fetchAuthIdentities(): Promise<{ provider: string; identity_data?: Record<string, unknown> }[]> {
  const { data } = await supabase.auth.getUser()
  const identities = data.user?.identities ?? []
  return identities.map((i) => ({ provider: i.provider, identity_data: i.identity_data ?? undefined }))
}

// ---------------------------------------------------------------------------
// completeAccount: bootstrap state after a non-Telegram sign-in (email/Google).
// Steps:
//  1. RPC get_my_account_context — read user + rooms via SECURITY DEFINER.
//  2. RPC sync_account_email — copy real email from auth.users to public.users.
//  3. Pick room: stored auth_room_id if it's a valid membership, else personal.
//  4. If JWT user_metadata is stale, write user_db_id + room_id and refresh session.
//  5. Persist user/room/rooms in localStorage and return.
// ---------------------------------------------------------------------------

async function readJwtMetadata(): Promise<{ user_db_id?: string; room_id?: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return {}
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const meta = payload?.user_metadata ?? {}
    return { user_db_id: meta.user_db_id, room_id: meta.room_id }
  } catch {
    return {}
  }
}

export async function completeAccount(): Promise<AccountContext> {
  const { data: ctxData, error: ctxError } = await supabase.rpc('get_my_account_context')
  if (ctxError) throw ctxError
  const ctx = ctxData as AccountContext
  if (!ctx?.user) throw new Error('Account context missing user')

  // Sync email from auth.users to public.users (idempotent on the server side).
  try { await supabase.rpc('sync_account_email') } catch { /* non-fatal */ }

  // Pick room: stored value (only if still a valid membership) > personal room.
  const storedRoomId = localStorage.getItem('auth_room_id')
  const storedRoomValid = storedRoomId && ctx.rooms.some((r) => r.id === storedRoomId)
  const roomId = storedRoomValid ? storedRoomId! : ctx.personal_room_id

  // If JWT metadata is stale, push fresh values + refresh the session so RLS works.
  const jwtMeta = await readJwtMetadata()
  if (jwtMeta.user_db_id !== ctx.user.id || jwtMeta.room_id !== roomId) {
    const { error: updateError } = await supabase.auth.updateUser({
      data: { user_db_id: ctx.user.id, room_id: roomId },
    })
    if (updateError) throw updateError
    await supabase.auth.refreshSession()
  }

  // Persist for offline UI.
  localStorage.setItem('auth_user', JSON.stringify(ctx.user))
  localStorage.setItem('auth_room_id', roomId)
  localStorage.setItem('auth_rooms', JSON.stringify(ctx.rooms))

  return { user: ctx.user, personal_room_id: ctx.personal_room_id, rooms: ctx.rooms }
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
    .select('user_id, users(id, first_name, last_name, telegram_id, photo_url, display_name, avatar_url, email, username)')
    .eq('room_id', roomId)

  return (data || []).map((m: any) => {
    const u = m.users
    const fullName = [u?.first_name, u?.last_name].filter(Boolean).join(' ')
    const displayName = u?.display_name
      || (fullName || u?.first_name)
      || (u?.username ? `@${u.username}` : '')
      || (u?.email && !String(u.email).endsWith('@telegram.user') ? u.email : '')
      || ''
    return {
      userId: u?.id ?? '',
      displayName,
      telegramId: typeof u?.telegram_id === 'number' ? u.telegram_id : undefined,
      photoUrl: u?.photo_url ?? u?.avatar_url ?? undefined,
    }
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
