import { useSyncExternalStore } from 'react'
import {
  applyUpdate,
  checkForUpdate,
  dismissOfflineReady,
  dismissUpdate,
  getPWAState,
  subscribePWA,
} from './register'

export function useUpdatePrompt() {
  const state = useSyncExternalStore(subscribePWA, getPWAState, getPWAState)

  return {
    needRefresh: state.needRefresh,
    offlineReady: state.offlineReady,
    applyUpdate,
    checkForUpdate,
    dismissUpdate: () => {
      dismissUpdate()
      dismissOfflineReady()
    },
  }
}
