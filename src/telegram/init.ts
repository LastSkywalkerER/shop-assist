import {
  init,
  backButton,
  miniApp,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react'

const THEME_LOG = '[Telegram Theme]'

/** Apply theme from legacy window.Telegram.WebApp.themeParams (fallback when SDK vars empty) */
function applyLegacyThemeParams(): boolean {
  const webApp = (window as Window & { Telegram?: { WebApp?: { themeParams?: Record<string, string> } } })
    .Telegram?.WebApp
  const params = webApp?.themeParams
  if (!params || typeof params !== 'object') return false

  const toCssVar = (s: string) => s.replace(/_/g, '-').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')
  const root = document.documentElement
  let count = 0
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'string') {
      const varName = `--tg-theme-${toCssVar(key)}`
      root.style.setProperty(varName, value)
      count++
    }
  }
  if (count > 0) {
    console.log(THEME_LOG, 'Applied legacy themeParams:', count, 'vars, button:', params.button_color)
  }
  return count > 0
}

export function initTelegramApp(): boolean {
  try {
    init()
    console.log(THEME_LOG, 'SDK init OK')

    if (viewport.mount.isAvailable()) {
      viewport.mount()
      viewport.expand()
    }

    // Use mountSync (recommended) — async mount() can cause race with bindCssVars
    if (themeParams.mountSync.isAvailable()) {
      themeParams.mountSync()
      if (themeParams.bindCssVars.isAvailable()) {
        themeParams.bindCssVars()
        const btn = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim()
        console.log(THEME_LOG, 'mountSync + bindCssVars OK, button-color:', btn || '(empty)')
      }
    } else if (themeParams.mount.isAvailable()) {
      console.log(THEME_LOG, 'mountSync not available, using async mount')
      themeParams.mount().then(() => {
        if (themeParams.bindCssVars.isAvailable()) {
          themeParams.bindCssVars()
          const btn = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim()
          console.log(THEME_LOG, 'async mount + bindCssVars OK, button-color:', btn || '(empty)')
        }
      }).catch((e) => console.warn(THEME_LOG, 'async mount failed:', e))
    }

    if (miniApp.mount.isAvailable()) {
      miniApp.mount()
      // Do NOT call miniApp.bindCssVars() — it can override themeParams
    }

    if (backButton.mount.isAvailable()) {
      backButton.mount()
    }

    // Fallback: legacy WebApp.themeParams (Telegram injects before SDK may be ready)
    requestAnimationFrame(() => {
      const btn = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim()
      if (!btn && applyLegacyThemeParams()) {
        console.log(THEME_LOG, 'Used legacy fallback (SDK vars were empty)')
      }
      const finalBtn = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim()
      console.log(THEME_LOG, 'Final --tg-theme-button-color:', finalBtn || '(still empty)')

      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta && finalBtn) meta.setAttribute('content', finalBtn)
    })

    return true
  } catch (e) {
    console.warn(THEME_LOG, 'initTelegramApp error:', e)
    return false
  }
}
