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
          const launchParams = retrieveLaunchParams()
          console.log('🔍 Launch params:', launchParams)

          const initDataRaw = (launchParams as any).initDataRaw
          const initData = (launchParams as any).initData

          console.log('🔍 initDataRaw:', initDataRaw ? 'present' : 'missing')
          console.log('🔍 initData:', initData)

          if (initDataRaw && initData?.user) {
            console.log('✅ Mini App detected, auto-login starting...')
            // Автоматическая авторизация через Mini App
            const response = await loginWithMiniApp(initDataRaw)
            console.log('✅ Auto-login successful:', response.user)
            setUser(response.user)
            setRoomId(response.room_id)
          } else {
            console.log('ℹ️ Not in Mini App or no user data')
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
