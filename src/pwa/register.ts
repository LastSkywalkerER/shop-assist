import { registerSW } from 'virtual:pwa-register'

export type PWAState = {
  needRefresh: boolean
  offlineReady: boolean
}

let state: PWAState = { needRefresh: false, offlineReady: false }
const listeners = new Set<(s: PWAState) => void>()
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null
let initialized = false

function emit() {
  for (const fn of listeners) fn(state)
}

function setState(patch: Partial<PWAState>) {
  state = { ...state, ...patch }
  emit()
}

export function initPWA() {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  updateSWFn = registerSW({
    onNeedRefresh: () => setState({ needRefresh: true }),
    onOfflineReady: () => setState({ offlineReady: true }),
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
  })
}

export function getPWAState(): PWAState {
  return state
}

export function subscribePWA(fn: (s: PWAState) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function applyUpdate() {
  updateSWFn?.(true)
}

export function dismissUpdate() {
  setState({ needRefresh: false })
}

export function dismissOfflineReady() {
  setState({ offlineReady: false })
}

export async function checkForUpdate() {
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map((name) => caches.delete(name)))

  const reg = await navigator.serviceWorker?.getRegistration()
  await reg?.update()
}

// Register SW as soon as this module is imported (before React renders).
initPWA()
