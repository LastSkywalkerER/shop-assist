import { registerSW } from 'virtual:pwa-register'

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null

type UpdateCallbacks = {
  onNeedRefresh: () => void
  onOfflineReady: () => void
}

export function initPWA(callbacks: UpdateCallbacks) {
  updateSWFn = registerSW({
    onNeedRefresh: callbacks.onNeedRefresh,
    onOfflineReady: callbacks.onOfflineReady,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
  })
}

export function applyUpdate() {
  updateSWFn?.(true)
}

export function checkForUpdate() {
  navigator.serviceWorker?.getRegistration().then((reg) => {
    reg?.update()
  })
}
