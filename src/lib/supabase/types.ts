export interface User {
  id: string
  telegram_id: number
  username?: string
  first_name: string
  last_name?: string
  photo_url?: string
  auth_date: number
  created_at: string
  updated_at: string
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

export interface AuthResponse {
  user: User
  room_id: string
  access_token: string
  refresh_token: string
}
