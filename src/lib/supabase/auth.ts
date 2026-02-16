import { supabase } from './client'
import type { TelegramAuthData, AuthResponse } from './types'

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`

export async function loginWithTelegram(authData: TelegramAuthData): Promise<AuthResponse> {
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(authData),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Authentication failed')
  }

  const data: AuthResponse = await response.json()

  // Установить session в Supabase client
  if (data.access_token && data.refresh_token) {
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
  }

  // Сохранить данные в localStorage
  localStorage.setItem('auth_user', JSON.stringify(data.user))
  localStorage.setItem('auth_room_id', data.room_id)

  return data
}

export async function loginWithMiniApp(initDataRaw: string): Promise<AuthResponse> {
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initDataRaw }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Mini App authentication failed')
  }

  const data: AuthResponse = await response.json()

  // Установить session в Supabase client
  if (data.access_token && data.refresh_token) {
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
  }

  // Сохранить данные в localStorage
  localStorage.setItem('auth_user', JSON.stringify(data.user))
  localStorage.setItem('auth_room_id', data.room_id)

  return data
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
  localStorage.removeItem('auth_user')
  localStorage.removeItem('auth_room_id')
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
