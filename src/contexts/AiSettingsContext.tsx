import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { fetchAiSettings, updateAiSettings, type RoomAiSettings } from '../lib/supabase/aiSettings'
import { DEFAULT_MODELS } from '../lib/ai/models'

interface AiSettingsContextType {
  settings: RoomAiSettings | null
  /** Convenience flag: aiEnabled === true AND we have a roomId. */
  aiEnabled: boolean
  loading: boolean
  /** Apply a partial patch and persist it. */
  update: (patch: Partial<Omit<RoomAiSettings, 'roomId'>>) => Promise<void>
  reload: () => Promise<void>
}

const AiSettingsContext = createContext<AiSettingsContextType | null>(null)

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const { roomId, isAuthenticated } = useAuth()
  const [settings, setSettings] = useState<RoomAiSettings | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!roomId || !isAuthenticated) {
      setSettings(null)
      return
    }
    setLoading(true)
    try {
      const fresh = await fetchAiSettings(roomId)
      setSettings(fresh)
    } finally {
      setLoading(false)
    }
  }, [roomId, isAuthenticated])

  useEffect(() => {
    void load()
  }, [load])

  const update = useCallback(async (patch: Partial<Omit<RoomAiSettings, 'roomId'>>) => {
    if (!roomId) return
    const base: RoomAiSettings = settings ?? {
      roomId,
      aiEnabled: false,
      modelExtract: DEFAULT_MODELS.extract,
      modelValidate: DEFAULT_MODELS.validate,
      modelEscalate: DEFAULT_MODELS.escalate,
    }
    const next: RoomAiSettings = { ...base, ...patch, roomId }
    setSettings(next)
    try {
      await updateAiSettings(next)
    } catch (err) {
      // Revert on failure so UI doesn't lie.
      setSettings(base)
      throw err
    }
  }, [roomId, settings])

  const aiEnabled = !!(settings && settings.aiEnabled && roomId)

  return (
    <AiSettingsContext.Provider value={{ settings, aiEnabled, loading, update, reload: load }}>
      {children}
    </AiSettingsContext.Provider>
  )
}

export function useAiSettings(): AiSettingsContextType {
  const ctx = useContext(AiSettingsContext)
  if (!ctx) throw new Error('useAiSettings must be used inside AiSettingsProvider')
  return ctx
}
