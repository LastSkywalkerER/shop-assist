import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { retrieveLaunchParams } from '@telegram-apps/sdk-react'
import {
  loginWithTelegram,
  loginWithMiniApp,
  logout as authLogout,
  getCurrentSession,
  getStoredUser,
  getStoredRoomId,
  getStoredRooms,
  switchRoom as apiSwitchRoom,
  fetchUserRooms,
  acceptInvite,
} from '../lib/supabase/auth'
import type { User, TelegramAuthData, RoomWithRole, InviteResult } from '../lib/supabase/types'

interface AuthContextType {
  user: User | null
  roomId: string | null
  rooms: RoomWithRole[]
  currentRoom: RoomWithRole | null
  isAuthenticated: boolean
  isLoading: boolean
  inviteResult: InviteResult | null
  login: (telegramData: TelegramAuthData) => Promise<void>
  logout: () => Promise<void>
  switchRoom: (roomId: string) => Promise<void>
  refreshRooms: () => Promise<void>
  clearInviteResult: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

/** Try to get Mini App initDataRaw from all available sources (all synchronous). */
function getMiniAppInitData(): string | null {
  // Method 1: @telegram-apps/sdk-react
  try {
    const launchParams = retrieveLaunchParams() as Record<string, unknown>
    const raw = launchParams.initDataRaw as string | undefined
    const hasUser = !!(launchParams.initData as { user?: unknown })?.user
    if (raw && hasUser) return raw
  } catch { /* not available */ }

  // Method 2: window.Telegram.WebApp
  if (typeof window !== 'undefined') {
    const webApp = (window as { Telegram?: { WebApp?: Record<string, unknown> } }).Telegram?.WebApp
    if (webApp) {
      const raw = webApp.initData as string | undefined
      const hasUser = !!(webApp.initDataUnsafe as { user?: unknown })?.user
      if (raw && hasUser) return raw
    }
  }

  // Method 3: window.__telegram__initParams
  if (typeof window !== 'undefined') {
    const initParams = (window as Window & { __telegram__initParams?: { tgWebAppData?: string } }).__telegram__initParams
    if (initParams?.tgWebAppData) return initParams.tgWebAppData
  }

  return null
}

/** Extract invite code from URL query param (?invite=CODE) and clean the URL. */
function extractInviteFromUrl(): string | null {
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('invite')
    if (code) {
      // Clean invite param from URL without reload
      url.searchParams.delete('invite')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      return code
    }
  } catch { /* ignore */ }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<RoomWithRole[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)

  const currentRoom = rooms.find(r => r.id === roomId) || null

  const refreshRooms = useCallback(async () => {
    try {
      const freshRooms = await fetchUserRooms()
      setRooms(freshRooms)
      localStorage.setItem('auth_rooms', JSON.stringify(freshRooms))
    } catch (e) {
      console.error('Failed to refresh rooms:', e)
    }
  }, [])

  useEffect(() => {
    const urlInviteCode = extractInviteFromUrl()

    const handleUrlInvite = async (code: string) => {
      try {
        const result = await acceptInvite(code)
        setInviteResult({
          status: result.room_id ? 'joined' : 'already_member',
          room_id: result.room_id,
          room_name: result.room_name,
          role: result.role,
        })
        // Refresh rooms after accepting invite
        const freshRooms = await fetchUserRooms()
        setRooms(freshRooms)
        localStorage.setItem('auth_rooms', JSON.stringify(freshRooms))
      } catch (e) {
        console.error('Failed to accept invite from URL:', e)
      }
    }

    const initAuth = async () => {
      try {
        const session = await getCurrentSession()
        if (session) {
          const storedUser = getStoredUser()
          const storedRoomId = getStoredRoomId()
          const storedRooms = getStoredRooms()

          if (storedUser && storedRoomId) {
            setUser(storedUser)
            setRoomId(storedRoomId)
            setRooms(storedRooms)
            setIsLoading(false)
            // Handle URL invite if present
            if (urlInviteCode) {
              handleUrlInvite(urlInviteCode)
            } else {
              // Refresh rooms in background
              fetchUserRooms().then(fresh => {
                setRooms(fresh)
                localStorage.setItem('auth_rooms', JSON.stringify(fresh))
              }).catch(() => {})
            }
            return
          }
        }

        // Try Mini App auto-login (all sources are synchronous, no delay needed)
        try {
          const initData = getMiniAppInitData()

          if (initData) {
            console.log('Mini App detected, auto-login starting...')
            const response = await loginWithMiniApp(initData)
            setUser(response.user)
            setRoomId(response.room_id)
            setRooms(response.rooms || [])
            if (response.invite_result) {
              setInviteResult(response.invite_result)
            }
          }
        } catch (miniAppError) {
          console.log('Not running in Mini App or no initData:', miniAppError)
        }
      } catch (error) {
        console.error('Failed to restore session:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initAuth()
  }, [])

  const login = async (telegramData: TelegramAuthData) => {
    try {
      const response = await loginWithTelegram(telegramData)
      setUser(response.user)
      setRoomId(response.room_id)
      setRooms(response.rooms || [])
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  const logout = async () => {
    try {
      await authLogout()
      setUser(null)
      setRoomId(null)
      setRooms([])
    } catch (error) {
      console.error('Logout failed:', error)
      throw error
    }
  }

  const switchRoom = async (newRoomId: string) => {
    if (newRoomId === roomId) return
    try {
      await apiSwitchRoom(newRoomId)
      setRoomId(newRoomId)
    } catch (error) {
      console.error('Switch room failed:', error)
      throw error
    }
  }

  const clearInviteResult = () => setInviteResult(null)

  return (
    <AuthContext.Provider
      value={{
        user,
        roomId,
        rooms,
        currentRoom,
        isAuthenticated: !!user,
        isLoading,
        inviteResult,
        login,
        logout,
        switchRoom,
        refreshRooms,
        clearInviteResult,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
