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
      // Do NOT call miniApp.bindCssVars() — it can override themeParams and cause
      // Telegram green accent to roll back to blue. Use themeParams only for theme.
    }

    if (backButton.mount.isAvailable()) {
      backButton.mount()
    }

    // Sync meta theme-color with Telegram accent (avoids hardcoded blue when Telegram uses green)
    requestAnimationFrame(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue('--tg-theme-button-color')
        .trim()
      if (meta && color) meta.setAttribute('content', color)
    })

    return true
  } catch {
    return false
  }
}
