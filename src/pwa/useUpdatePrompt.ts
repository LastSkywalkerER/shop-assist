import { useState, useEffect } from 'react'
import { initPWA, applyUpdate, checkForUpdate } from './register'

export function useUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    initPWA({
      onNeedRefresh: () => setNeedRefresh(true),
      onOfflineReady: () => setOfflineReady(true),
    })
  }, [])

  return {
    needRefresh,
    offlineReady,
    applyUpdate,
    checkForUpdate,
    dismissUpdate: () => setNeedRefresh(false),
  }
}
