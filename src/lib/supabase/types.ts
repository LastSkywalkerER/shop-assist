export interface User {
  id: string
  telegram_id?: number
  username?: string
  first_name?: string
  last_name?: string
  photo_url?: string
  auth_date?: number
  email?: string
  google_id?: string
  display_name?: string
  avatar_url?: string
  auth_user_id?: string
  notify_via_pwa?: boolean
  notify_via_telegram?: boolean
  created_at: string
  updated_at: string
}

export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent?: string
  created_at: string
  last_used_at: string
}

export interface Room {
  id: string
  name: string
  owner_id: string
  is_personal: boolean
  created_at: string
  updated_at: string
}

export interface RoomMembership {
  id: string
  user_id: string
  room_id: string
  role: 'owner' | 'editor' | 'viewer' | 'member'
  joined_at: string
}

export interface TelegramAuthData {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export interface RoomWithRole extends Room {
  role: 'owner' | 'editor' | 'viewer'
}

export interface InviteResult {
  status: 'joined' | 'already_member' | 'expired' | 'not_found'
  room_id?: string
  room_name?: string
  role?: string
}

export interface AuthResponse {
  user: User
  room_id: string
  rooms: RoomWithRole[]
  access_token: string
  refresh_token: string
  invite_result?: InviteResult | null
}

export interface SwitchRoomResponse {
  room: Room
  role: string
  access_token: string
  refresh_token: string
}

export interface InviteResponse {
  invite: {
    id: string
    room_id: string
    invite_code: string
    role: string
  }
  deep_link: string
}

export interface AcceptInviteResponse {
  message: string
  room_id: string
  room_name?: string
  role?: string
}

export interface RoomMember {
  userId: string
  displayName: string
  telegramId?: number
  photoUrl?: string
}

export interface AccountContext {
  user: User
  personal_room_id: string
  rooms: RoomWithRole[]
}
