import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { retrieveLaunchParams } from '@telegram-apps/sdk-react'
import { loginWithTelegram, loginWithMiniApp, logout as authLogout, getCurrentSession, getStoredUser, getStoredRoomId } from '../lib/supabase/auth'
import type { User, TelegramAuthData } from '../lib/supabase/types'

interface AuthContextType {
  user: User | null
  roomId: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (telegramData: TelegramAuthData) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Проверить сохраненную сессию или авто-авторизоваться через Mini App
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Сначала проверить сохраненную сессию
        const session = await getCurrentSession()
        if (session) {
          const storedUser = getStoredUser()
          const storedRoomId = getStoredRoomId()

          if (storedUser && storedRoomId) {
            setUser(storedUser)
            setRoomId(storedRoomId)
            setIsLoading(false)
            return
          }
        }

        // Если нет сессии, попробовать авто-авторизацию через Mini App
        try {
          // Подождать немного, чтобы Telegram SDK успел загрузиться
          await new Promise(resolve => setTimeout(resolve, 300))

          // Попробовать несколько способов получить initData
          let initDataRawValue: string | undefined
          let hasUserData = false

          // Способ 1: через retrieveLaunchParams
          try {
            const launchParams = retrieveLaunchParams() as Record<string, unknown>
            console.log('🔍 Launch params:', launchParams)
            initDataRawValue = launchParams.initDataRaw as string | undefined
            hasUserData = !!(launchParams.initData as { user?: unknown })?.user
            console.log('🔍 Method 1 - retrieveLaunchParams:', { initDataRaw: !!initDataRawValue, hasUser: hasUserData })
          } catch (e) {
            console.log('🔍 Method 1 failed:', e)
          }

          // Способ 2: через window.Telegram.WebApp
          if (!initDataRawValue && typeof window !== 'undefined') {
            const windowTelegram = (window as { Telegram?: { WebApp?: Record<string, unknown> } }).Telegram
            const webApp = windowTelegram?.WebApp
            if (webApp) {
              initDataRawValue = webApp.initData as string | undefined
              hasUserData = !!(webApp.initDataUnsafe as { user?: unknown })?.user
              console.log('🔍 Method 2 - window.Telegram.WebApp:', { initDataRaw: !!initDataRawValue, hasUser: hasUserData })
            }
          }

          // Способ 3: напрямую из window.__telegram__initParams
          if (!initDataRawValue && typeof window !== 'undefined') {
            const initParams = (window as Window & { __telegram__initParams?: { tgWebAppData?: string } }).__telegram__initParams
            if (initParams?.tgWebAppData) {
              initDataRawValue = initParams.tgWebAppData
              hasUserData = true
              console.log('🔍 Method 3 - __telegram__initParams:', { initDataRaw: !!initDataRawValue })
            }
          }

          if (initDataRawValue && hasUserData) {
            console.log('✅ Mini App detected, auto-login starting...')
            console.log('🔍 initDataRaw length:', initDataRawValue.length)
            // Автоматическая авторизация через Mini App
            const response = await loginWithMiniApp(initDataRawValue)
            console.log('✅ Auto-login successful:', response.user)
            setUser(response.user)
            setRoomId(response.room_id)
          } else {
            console.log('ℹ️ Not in Mini App or no user data', { initDataRaw: !!initDataRawValue, hasUser: hasUserData })
          }
        } catch (miniAppError) {
          // Не в Mini App или нет initData - это нормально для web версии
          console.log('ℹ️ Not running in Mini App or no initData:', miniAppError)
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
    } catch (error) {
      console.error('Logout failed:', error)
      throw error
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        roomId,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
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
