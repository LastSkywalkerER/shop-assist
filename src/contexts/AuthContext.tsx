import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
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
  signUpWithEmail as authSignUpWithEmail,
  signInWithEmail as authSignInWithEmail,
  signInWithGoogle as authSignInWithGoogle,
  linkGoogleProvider as authLinkGoogleProvider,
  linkTelegram as authLinkTelegram,
  setEmailPassword as authSetEmailPassword,
  completeAccount,
  reconcileJwtRoom,
  type EmailSignUpResult,
} from '../lib/supabase/auth'
import { supabase } from '../lib/supabase/client'
import { getMiniAppInitData } from '../telegram/detect'
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
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<EmailSignUpResult>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  linkGoogle: () => Promise<void>
  linkTelegram: (authData: TelegramAuthData) => Promise<void>
  setEmailPassword: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  switchRoom: (roomId: string) => Promise<void>
  refreshRooms: () => Promise<void>
  clearInviteResult: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

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

/** Extract invite code from Telegram Mini App start_param (inv_CODE). */
function extractInviteFromStartParam(): string | null {
  try {
    // Method 1: @telegram-apps/sdk-react
    const launchParams = retrieveLaunchParams() as Record<string, unknown>
    const startParam = launchParams.startParam as string | undefined
    if (startParam?.startsWith('inv_')) return startParam.slice(4)
  } catch { /* not available */ }

  try {
    // Method 2: window.Telegram.WebApp initDataUnsafe
    const webApp = (window as { Telegram?: { WebApp?: Record<string, unknown> } }).Telegram?.WebApp
    const startParam = (webApp?.initDataUnsafe as { start_param?: string } | undefined)?.start_param
    if (startParam?.startsWith('inv_')) return startParam.slice(4)
  } catch { /* ignore */ }

  try {
    // Method 3: parse start_param from raw initData string
    const initData = getMiniAppInitData()
    if (initData) {
      const params = new URLSearchParams(initData)
      const startParam = params.get('start_param')
      if (startParam?.startsWith('inv_')) return startParam.slice(4)
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
  // Avoid re-running completeAccount on every USER_UPDATED firing for the same auth user.
  const lastCompletedAuthUserId = useRef<string | null>(null)

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

  const applyAccountContext = useCallback(async (authUserId: string) => {
    if (lastCompletedAuthUserId.current === authUserId) return
    try {
      const ctx = await completeAccount()
      lastCompletedAuthUserId.current = authUserId
      setUser(ctx.user)
      const storedRoomId = localStorage.getItem('auth_room_id')
      setRoomId(storedRoomId || ctx.personal_room_id)
      setRooms(ctx.rooms)
    } catch (e) {
      console.error('completeAccount failed:', e)
    }
  }, [])

  useEffect(() => {
    const urlInviteCode = extractInviteFromUrl() || extractInviteFromStartParam()

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
          const sessionAuthUserId = session.user.id
          const storedMatches = storedUser && storedUser.auth_user_id === sessionAuthUserId

          if (storedMatches && storedRoomId) {
            setUser(storedUser)
            setRoomId(storedRoomId)
            setRooms(storedRooms)
            lastCompletedAuthUserId.current = sessionAuthUserId
            setIsLoading(false)
            // This fast path skips completeAccount(), so heal a JWT room_id that
            // drifted from the active room (e.g. a room switch that didn't
            // refresh the token). Without this, Storage RLS (receipt upload)
            // and replication push keep targeting the stale JWT room. Runs in
            // the background; the resulting USER_UPDATED/TOKEN_REFRESHED is
            // absorbed by the lastCompletedAuthUserId guard above.
            reconcileJwtRoom(storedRoomId, storedUser.id).catch((e) =>
              console.error('JWT room reconcile failed:', e),
            )
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

          // Session exists (e.g. returned from Google OAuth or email confirm)
          // but stored state is empty/stale → finish account bootstrap.
          await applyAccountContext(sessionAuthUserId)
          if (urlInviteCode) handleUrlInvite(urlInviteCode)
          return
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
  }, [applyAccountContext])

  // React to OAuth callback / email-confirm / linkIdentity / updateUser by re-running completeAccount.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session?.user?.id) return
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        applyAccountContext(session.user.id)
      }
    })
    return () => { data.subscription.unsubscribe() }
  }, [applyAccountContext])

  const login = async (telegramData: TelegramAuthData) => {
    try {
      const response = await loginWithTelegram(telegramData)
      lastCompletedAuthUserId.current = null
      setUser(response.user)
      setRoomId(response.room_id)
      setRooms(response.rooms || [])
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    return authSignUpWithEmail(email, password, displayName)
    // If email confirmation is required, no session yet — onAuthStateChange will fire after confirm.
    // If confirmation is off, SIGNED_IN fires immediately and applyAccountContext takes over.
  }

  const signInWithEmail = async (email: string, password: string) => {
    const ctx = await authSignInWithEmail(email, password)
    lastCompletedAuthUserId.current = ctx.user.auth_user_id ?? null
    setUser(ctx.user)
    setRoomId(localStorage.getItem('auth_room_id') || ctx.personal_room_id)
    setRooms(ctx.rooms)
  }

  const signInWithGoogle = async () => {
    await authSignInWithGoogle()
    // Browser redirects to Google; on return, onAuthStateChange handles the rest.
  }

  const linkGoogle = async () => {
    await authLinkGoogleProvider()
  }

  const linkTelegram = async (authData: TelegramAuthData) => {
    await authLinkTelegram(authData)
    // public.users was updated server-side without changing auth state, so
    // onAuthStateChange won't fire. Force-refresh the context.
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) {
      lastCompletedAuthUserId.current = null
      await applyAccountContext(session.user.id)
    }
  }

  const setEmailPassword = async (email: string, password: string) => {
    await authSetEmailPassword(email, password)
    // USER_UPDATED fires; applyAccountContext will sync_account_email + refresh metadata.
    // Force re-run because the auth user id is unchanged but data changed.
    lastCompletedAuthUserId.current = null
  }

  const logout = async () => {
    try {
      await authLogout()
      lastCompletedAuthUserId.current = null
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
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        linkGoogle,
        linkTelegram,
        setEmailPassword,
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
