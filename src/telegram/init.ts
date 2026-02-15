import {
  init,
  backButton,
  miniApp,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react'

export function initTelegramApp(): boolean {
  try {
    init()

    if (viewport.mount.isAvailable()) {
      viewport.mount()
      viewport.expand()
    }

    if (themeParams.mount.isAvailable()) {
      themeParams.mount()
      themeParams.bindCssVars()
    }

    if (miniApp.mount.isAvailable()) {
      miniApp.mount()
      miniApp.bindCssVars()
    }

    if (backButton.mount.isAvailable()) {
      backButton.mount()
    }

    return true
  } catch {
    return false
  }
}
